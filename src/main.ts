import * as utils from "@iobroker/adapter-core";
import {
  buildDeviceStateDefs,
  mapCloudStateValue,
} from "./lib/capability-mapper.js";
import { DeviceManager } from "./lib/device-manager.js";
import { GoveeAppApiClient } from "./lib/govee-app-api-client.js";
import { GoveeCloudClient } from "./lib/govee-cloud-client.js";
import { GoveeMqttClient } from "./lib/govee-mqtt-client.js";
import { GoveeOpenapiMqttClient } from "./lib/govee-openapi-mqtt-client.js";
import { RateLimiter } from "./lib/rate-limiter.js";
import { SkuCache } from "./lib/sku-cache.js";
import { StateManager } from "./lib/state-manager.js";
import type {
  AdapterConfig,
  ApplianceDevice,
  CloudStateCapability,
} from "./lib/types.js";

/** Rate limit defaults */
const FULL_LIMITS = { perMinute: 8, perDay: 9000 };
const SHARED_LIMITS = { perMinute: 4, perDay: 4500 };
/**
 * Alive-state pattern for govee-smart instances. The adapter subscribes to
 * every matching instance so a `.0` / `.1` multi-instance setup all participate
 * in the shared rate-limit halving instead of silently running both adapters
 * at full budget.
 */
const SIBLING_ALIVE_PATTERN = "system.adapter.govee-smart.*.alive";
/**
 * Simple test matching the pattern above against a concrete state id.
 *
 * @param id Fully-qualified foreign state id (e.g. `system.adapter.govee-smart.0.alive`)
 */
function isSiblingAliveId(id: string): boolean {
  return id.startsWith("system.adapter.govee-smart.") && id.endsWith(".alive");
}

class GoveeAppliancesAdapter extends utils.Adapter {
  private deviceManager: DeviceManager | null = null;
  private stateManager: StateManager | null = null;
  private mqttClient: GoveeMqttClient | null = null;
  private openapiMqttClient: GoveeOpenapiMqttClient | null = null;
  private cloudClient: GoveeCloudClient | null = null;
  private appApiClient: GoveeAppApiClient | null = null;
  private rateLimiter: RateLimiter | null = null;
  private skuCache: SkuCache | null = null;
  private pollTimer: ioBroker.Interval | undefined;
  private appApiPollTimer: ioBroker.Interval | undefined;
  private readyLogged = false;
  private siblingActive = false;
  /** Active govee-smart instance ids (e.g. "govee-smart.0") */
  private siblingInstancesAlive = new Set<string>();

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "govee-appliances" });
    this.on("ready", () => {
      this.onReady().catch((err) => {
        this.log.error(
          `onReady failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      });
    });
    this.on("stateChange", (id, state) => {
      this.onStateChange(id, state).catch((err) => {
        this.log.error(
          `onStateChange failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    this.on("unload", (callback) => this.onUnload(callback));
    process.on("unhandledRejection", (reason) => {
      this.log.error(
        `Unhandled promise rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
      );
    });
  }

  /** Adapter started — initialize all channels */
  private async onReady(): Promise<void> {
    this.log.warn(
      "This adapter is DEPRECATED. Please install ioBroker.govee-smart v2.0.0+ which now handles Govee appliances and sensors together with lights. See https://github.com/krobipd/ioBroker.govee-smart",
    );

    const config = this.config as unknown as AdapterConfig;

    if (!config.apiKey) {
      this.log.error("No API key configured — adapter cannot start");
      return;
    }

    // Ensure info states exist
    await this.setObjectNotExistsAsync("info", {
      type: "channel",
      common: { name: "Information" },
      native: {},
    });
    const infoStates: Array<[string, string]> = [
      ["connection", "Connection status"],
      ["mqttConnected", "MQTT connected"],
      ["openapiMqttConnected", "OpenAPI MQTT connected"],
    ];
    for (const [id, name] of infoStates) {
      await this.setObjectNotExistsAsync(`info.${id}`, {
        type: "state",
        common: {
          name,
          type: "boolean",
          role: "indicator.connected",
          read: true,
          write: false,
          def: false,
        },
        native: {},
      });
      await this.setStateAsync(`info.${id}`, { val: false, ack: true });
    }

    // Initialize components
    this.stateManager = new StateManager(this);
    this.deviceManager = new DeviceManager(this.log);

    const dataDir = utils.getAbsoluteInstanceDataDir(this);
    this.skuCache = new SkuCache(dataDir, this.log);
    this.deviceManager.setSkuCache(this.skuCache);

    // Cloud API
    this.cloudClient = new GoveeCloudClient(config.apiKey, this.log);
    this.deviceManager.setCloudClient(this.cloudClient);

    // Rate limiter
    const timers = {
      setInterval: (cb: () => void, ms: number) => this.setInterval(cb, ms),
      clearInterval: (t: ioBroker.Interval) => this.clearInterval(t),
      setTimeout: (cb: () => void, ms: number) => this.setTimeout(cb, ms),
      clearTimeout: (t: ioBroker.Timeout) => this.clearTimeout(t),
    };
    this.rateLimiter = new RateLimiter(
      this.log,
      timers,
      FULL_LIMITS.perMinute,
      FULL_LIMITS.perDay,
    );
    this.rateLimiter.start();
    this.deviceManager.setRateLimiter(this.rateLimiter);

    // Detect sibling adapter (govee-smart) for shared rate limits
    await this.detectSiblingAdapter();

    // Device callbacks
    this.deviceManager.setOnDeviceUpdate(
      (device: ApplianceDevice, caps: CloudStateCapability[]) => {
        void this.handleDeviceUpdate(device, caps);
      },
    );
    this.deviceManager.setOnDeviceListChanged((devices: ApplianceDevice[]) => {
      void this.handleDeviceListChanged(devices);
    });

    // Load from cache first (fast startup)
    this.deviceManager.loadFromCache();

    // MQTT (optional — needs email + password)
    if (config.goveeEmail && config.goveePassword) {
      this.mqttClient = new GoveeMqttClient(
        config.goveeEmail,
        config.goveePassword,
        this.log,
        timers,
      );
      // App-API client shares the bearer token we get from the MQTT login.
      // It polls the undocumented device-list endpoint to fill in sensor
      // values (temperature/humidity/battery) that OpenAPI v2 `/device/state`
      // leaves empty for cloud-synced devices like the H5179 thermometer.
      this.appApiClient = new GoveeAppApiClient();
      this.deviceManager.setAppApiClient(this.appApiClient);
      void this.mqttClient.connect(
        (update) => this.deviceManager!.handleMqttStatus(update),
        (connected) => {
          void this.setStateAsync("info.mqttConnected", {
            val: connected,
            ack: true,
          });
        },
        (deviceId, packets) =>
          this.deviceManager!.handleRawPackets(deviceId, packets),
        (token) => this.appApiClient?.setBearerToken(token),
      );
    }

    // OpenAPI MQTT for sensor events (only needs API key)
    this.openapiMqttClient = new GoveeOpenapiMqttClient(
      config.apiKey,
      this.log,
      timers,
    );
    this.openapiMqttClient.connect(
      (event) => this.deviceManager!.handleOpenApiEvent(event),
      (connected) => {
        void this.setStateAsync("info.openapiMqttConnected", {
          val: connected,
          ack: true,
        });
      },
      (rawJson) => this.deviceManager!.handleOpenApiRaw(rawJson),
    );

    // Cloud init — load devices + first state poll
    try {
      await this.deviceManager.loadFromCloud();
      await this.setStateAsync("info.connection", { val: true, ack: true });

      // Create states for all devices
      await this.createAllDeviceStates();

      // First state poll
      await this.deviceManager.pollDeviceStates();
    } catch (err) {
      this.log.warn(
        `Cloud init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logReady();

    // Start polling timer
    const pollMs = Math.max(config.pollInterval || 120, 30) * 1000;
    this.pollTimer = this.setInterval(() => {
      void this.pollCycle();
    }, pollMs);

    // App-API polling — one call returns every device's latest lastDeviceData
    // in a single request. Runs at the same cadence as the Cloud poll because
    // the endpoint is cheap and Govee's apps typically hit it on every app
    // open / pull-to-refresh without issues.
    if (this.appApiClient) {
      this.appApiPollTimer = this.setInterval(() => {
        void this.appApiPollCycle();
      }, pollMs);
    }

    // Subscribe to all control states
    await this.subscribeStatesAsync("devices.*.control.*");
    await this.subscribeStatesAsync("devices.*.raw.diagnostics_export");
  }

  /** Polling cycle — refresh device states */
  private async pollCycle(): Promise<void> {
    if (!this.deviceManager) {
      return;
    }
    await this.deviceManager.pollDeviceStates();
  }

  /**
   * App-API polling — reads every device's last-known state via the
   * undocumented `/device/rest/devices/v1/list` endpoint in one call.
   * Fills in sensor values (temperature, humidity, battery, online) for
   * devices where OpenAPI `/device/state` returns an empty capability list.
   */
  private async appApiPollCycle(): Promise<void> {
    if (!this.deviceManager) {
      return;
    }
    await this.deviceManager.pollAppApi();
  }

  /**
   * Handle device state update from Cloud or MQTT
   *
   * @param device Appliance device
   * @param caps State capabilities
   */
  private async handleDeviceUpdate(
    device: ApplianceDevice,
    caps: CloudStateCapability[],
  ): Promise<void> {
    if (!this.stateManager) {
      return;
    }

    const values = caps.flatMap((cap) => mapCloudStateValue(cap));
    await this.stateManager.updateDeviceStates(device, values);

    // Update raw data states for diagnostics
    if (device.lastCloudStateResponse) {
      await this.stateManager.updateRawApiData(
        device,
        JSON.stringify(device.capabilities, null, 2),
        device.lastCloudStateResponse,
      );
    }
    if (device.rawMqttPacketCount > 0) {
      await this.stateManager.updateRawMqttData(device);
    }
    if (device.rawOpenapiEventCount > 0) {
      await this.stateManager.updateRawOpenapiData(device);
    }
  }

  /**
   * Handle device list change — recreate states
   *
   * @param devices Device list
   */
  private async handleDeviceListChanged(
    devices: ApplianceDevice[],
  ): Promise<void> {
    if (!this.stateManager) {
      return;
    }
    await this.createAllDeviceStates();
    await this.stateManager.cleanupDevices(devices);
  }

  /** Create ioBroker states for all known devices */
  private async createAllDeviceStates(): Promise<void> {
    if (!this.deviceManager || !this.stateManager) {
      return;
    }

    for (const device of this.deviceManager.getAllDevices()) {
      const stateDefs = buildDeviceStateDefs(device);
      await this.stateManager.createDeviceStates(device, stateDefs);

      // Write initial raw API data
      await this.stateManager.updateRawApiData(
        device,
        JSON.stringify(device.capabilities, null, 2),
      );
    }
  }

  /**
   * Handle state change from user (control commands)
   *
   * @param id Identifier string
   * @param state state
   */
  private async onStateChange(
    id: string,
    state: ioBroker.State | null | undefined,
  ): Promise<void> {
    // Sibling adapter alive state change (foreign state, always ack).
    // Any govee-smart instance (.0, .1, ...) contributes — the adapter halves
    // its budget when at least one is running, restores full limits only when
    // all are down.
    if (isSiblingAliveId(id)) {
      const instance = id
        .replace("system.adapter.", "")
        .replace(/\.alive$/, "");
      if (state?.val === true) {
        this.siblingInstancesAlive.add(instance);
      } else {
        this.siblingInstancesAlive.delete(instance);
      }
      this.applySiblingLimits(this.siblingInstancesAlive.size > 0);
      return;
    }

    if (!state || state.ack || !this.deviceManager || !this.stateManager) {
      return;
    }

    // Parse device prefix from state ID
    // Format: govee-appliances.0.devices.<sku_shortid>.<channel>.<stateId>
    const parts = id.replace(`${this.namespace}.`, "").split(".");
    if (parts.length < 4 || parts[0] !== "devices") {
      return;
    }

    const deviceFolder = parts[1];
    const channel = parts[2];
    const stateId = parts.slice(3).join(".");

    // Find device by folder name
    const device = this.deviceManager
      .getAllDevices()
      .find(
        (d) => this.stateManager!.devicePrefix(d) === `devices.${deviceFolder}`,
      );
    if (!device) {
      this.log.debug(`State change for unknown device folder: ${deviceFolder}`);
      return;
    }

    // Handle diagnostics export button
    if (channel === "raw" && stateId === "diagnostics_export") {
      const diagnostics = this.deviceManager.generateDiagnostics(device);
      const prefix = this.stateManager.devicePrefix(device);
      await this.setStateAsync(`${prefix}.raw.diagnostics_result`, {
        val: diagnostics,
        ack: true,
      });
      await this.setStateAsync(`${prefix}.raw.diagnostics_export`, {
        val: false,
        ack: true,
      });
      this.log.info(`Diagnostics exported for ${device.sku} (${device.name})`);
      return;
    }

    // Control commands — find capability from state native data
    if (channel === "control") {
      await this.handleControlCommand(device, deviceFolder, stateId, state.val);
    }
  }

  /**
   * Route a control command to the Cloud API
   *
   * @param device Appliance device
   * @param deviceFolder deviceFolder
   * @param stateId State ID suffix
   * @param value Value to send
   */
  private async handleControlCommand(
    device: ApplianceDevice,
    deviceFolder: string,
    stateId: string,
    value: ioBroker.StateValue,
  ): Promise<void> {
    // Read native capability info from state object
    const fullId = `devices.${deviceFolder}.control.${stateId}`;
    const obj = await this.getObjectAsync(fullId);
    if (!obj?.native?.capabilityType || !obj?.native?.capabilityInstance) {
      this.log.debug(`No capability info for ${fullId}`);
      return;
    }

    const capType = obj.native.capabilityType as string;
    const capInstance = obj.native.capabilityInstance as string;

    // Convert ioBroker value to API value
    const apiValue = this.toCloudValue(
      device,
      capType,
      capInstance,
      stateId,
      value,
    );
    if (apiValue === undefined) {
      return;
    }

    try {
      await this.deviceManager!.sendCommand(
        device,
        capType,
        capInstance,
        apiValue,
      );
      this.log.debug(
        `Command sent: ${device.sku} ${capInstance} = ${JSON.stringify(apiValue)}`,
      );
    } catch (err) {
      this.log.warn(
        `Command failed for ${device.sku}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Convert ioBroker state value to Cloud API value.
   *
   * @param device Appliance device
   * @param capType capType
   * @param capInstance capInstance
   * @param stateId State ID suffix
   * @param value Value to send
   */
  private toCloudValue(
    device: ApplianceDevice,
    capType: string,
    capInstance: string,
    stateId: string,
    value: ioBroker.StateValue,
  ): unknown {
    const shortType = capType.replace("devices.capabilities.", "");

    switch (shortType) {
      case "on_off":
      case "toggle":
        return value ? 1 : 0;

      case "range":
        return typeof value === "number" ? value : Number(value);

      case "work_mode": {
        // Work mode needs STRUCT value {workMode: N, modeValue: N}
        if (stateId === "work_mode") {
          // Read current mode_value to build complete struct
          const currentModeValue = device.state.modeValue ?? 0;
          return { workMode: Number(value), modeValue: currentModeValue };
        }
        if (stateId === "mode_value") {
          const currentWorkMode = device.state.workMode ?? 1;
          return { workMode: currentWorkMode, modeValue: Number(value) };
        }
        return value;
      }

      case "temperature_setting":
        return typeof value === "number" ? value : Number(value);

      case "color_setting": {
        if (capInstance === "colorRgb" && typeof value === "string") {
          const hex = value.replace("#", "");
          const num = parseInt(hex, 16);
          return isNaN(num) ? 0 : num;
        }
        return typeof value === "number" ? value : Number(value);
      }

      case "mode":
        if (typeof value === "string" && value.startsWith("{")) {
          try {
            return JSON.parse(value);
          } catch {
            this.log.warn(
              `Invalid JSON for mode value on ${device.sku}: ${value.slice(0, 80)}`,
            );
            return undefined;
          }
        }
        return value;

      default:
        return value;
    }
  }

  /**
   * Detect which govee-smart instances (if any) are running. Subscribes to
   * the whole `system.adapter.govee-smart.*.alive` namespace so start/stop
   * of any instance feeds back into applySiblingLimits.
   */
  private async detectSiblingAdapter(): Promise<void> {
    try {
      const instances = await this.getForeignObjectsAsync(
        "system.adapter.govee-smart.*",
        "instance",
      );
      for (const id of Object.keys(instances ?? {})) {
        const state = await this.getForeignStateAsync(`${id}.alive`);
        if (state?.val === true) {
          this.siblingInstancesAlive.add(id.replace("system.adapter.", ""));
        }
      }
      this.applySiblingLimits(this.siblingInstancesAlive.size > 0);
      await this.subscribeForeignStatesAsync(SIBLING_ALIVE_PATTERN);
    } catch {
      // Sibling not installed — use full limits
      this.applySiblingLimits(false);
    }
  }

  /**
   * Apply rate limits based on sibling adapter presence.
   *
   * @param siblingAlive Whether the sibling adapter is running
   */
  private applySiblingLimits(siblingAlive: boolean): void {
    if (!this.rateLimiter || this.siblingActive === siblingAlive) {
      return;
    }
    this.siblingActive = siblingAlive;

    if (siblingAlive) {
      this.rateLimiter.updateLimits(
        SHARED_LIMITS.perMinute,
        SHARED_LIMITS.perDay,
      );
      this.log.info(
        `govee-smart detected — sharing API budget (${SHARED_LIMITS.perMinute}/min, ${SHARED_LIMITS.perDay}/day)`,
      );
    } else {
      this.rateLimiter.updateLimits(FULL_LIMITS.perMinute, FULL_LIMITS.perDay);
      this.log.info(
        `govee-smart not active — using full API budget (${FULL_LIMITS.perMinute}/min, ${FULL_LIMITS.perDay}/day)`,
      );
    }
  }

  /** Log ready message with device summary */
  private logReady(): void {
    if (this.readyLogged) {
      return;
    }
    this.readyLogged = true;

    const devices = this.deviceManager?.getAllDevices() ?? [];
    const iotMqtt = this.mqttClient ? "IoT-MQTT" : "";
    const apiMqtt = this.openapiMqttClient ? "OpenAPI-MQTT" : "";
    const channels = ["Cloud", iotMqtt, apiMqtt].filter(Boolean).join(", ");

    if (devices.length === 0) {
      this.log.info(`Ready with channels: ${channels} — no appliances found`);
    } else {
      const types = new Map<string, number>();
      for (const d of devices) {
        const shortType = (d.type ?? "unknown").replace("devices.types.", "");
        types.set(shortType, (types.get(shortType) ?? 0) + 1);
      }
      const summary = Array.from(types.entries())
        .map(([t, c]) => `${c}× ${t}`)
        .join(", ");
      this.log.info(
        `Ready with channels: ${channels} — ${devices.length} appliances (${summary})`,
      );
    }
  }

  /**
   * Adapter stopping — cleanup synchronously
   *
   * @param callback Callback function
   */
  private onUnload(callback: () => void): void {
    try {
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      if (this.appApiPollTimer) {
        this.clearInterval(this.appApiPollTimer);
        this.appApiPollTimer = undefined;
      }
      this.rateLimiter?.stop();
      this.mqttClient?.disconnect();
      this.openapiMqttClient?.disconnect();
      void this.setState("info.connection", { val: false, ack: true });
      void this.setState("info.mqttConnected", { val: false, ack: true });
      void this.setState("info.openapiMqttConnected", {
        val: false,
        ack: true,
      });
    } catch {
      // ignore errors during unload
    }
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) =>
    new GoveeAppliancesAdapter(options);
} else {
  new GoveeAppliancesAdapter();
}
