"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_capability_mapper = require("./lib/capability-mapper.js");
var import_device_manager = require("./lib/device-manager.js");
var import_govee_app_api_client = require("./lib/govee-app-api-client.js");
var import_govee_cloud_client = require("./lib/govee-cloud-client.js");
var import_govee_mqtt_client = require("./lib/govee-mqtt-client.js");
var import_govee_openapi_mqtt_client = require("./lib/govee-openapi-mqtt-client.js");
var import_rate_limiter = require("./lib/rate-limiter.js");
var import_sku_cache = require("./lib/sku-cache.js");
var import_state_manager = require("./lib/state-manager.js");
const FULL_LIMITS = { perMinute: 8, perDay: 9e3 };
const SHARED_LIMITS = { perMinute: 4, perDay: 4500 };
const SIBLING_ALIVE_PATTERN = "system.adapter.govee-smart.*.alive";
function isSiblingAliveId(id) {
  return id.startsWith("system.adapter.govee-smart.") && id.endsWith(".alive");
}
class GoveeAppliancesAdapter extends utils.Adapter {
  deviceManager = null;
  stateManager = null;
  mqttClient = null;
  openapiMqttClient = null;
  cloudClient = null;
  appApiClient = null;
  rateLimiter = null;
  skuCache = null;
  pollTimer;
  appApiPollTimer;
  readyLogged = false;
  siblingActive = false;
  /** Active govee-smart instance ids (e.g. "govee-smart.0") */
  siblingInstancesAlive = /* @__PURE__ */ new Set();
  constructor(options = {}) {
    super({ ...options, name: "govee-appliances" });
    this.on("ready", () => {
      this.onReady().catch((err) => {
        var _a;
        this.log.error(
          `onReady failed: ${err instanceof Error ? (_a = err.stack) != null ? _a : err.message : String(err)}`
        );
      });
    });
    this.on("stateChange", (id, state) => {
      this.onStateChange(id, state).catch((err) => {
        this.log.error(
          `onStateChange failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    });
    this.on("unload", (callback) => this.onUnload(callback));
    process.on("unhandledRejection", (reason) => {
      var _a;
      this.log.error(
        `Unhandled promise rejection: ${reason instanceof Error ? (_a = reason.stack) != null ? _a : reason.message : String(reason)}`
      );
    });
  }
  /** Adapter started — initialize all channels */
  async onReady() {
    this.log.warn(
      "This adapter is DEPRECATED. Please install ioBroker.govee-smart v2.0.0+ which now handles Govee appliances and sensors together with lights. See https://github.com/krobipd/ioBroker.govee-smart"
    );
    const config = this.config;
    if (!config.apiKey) {
      this.log.error("No API key configured \u2014 adapter cannot start");
      return;
    }
    await this.setObjectNotExistsAsync("info", {
      type: "channel",
      common: { name: "Information" },
      native: {}
    });
    const infoStates = [
      ["connection", "Connection status"],
      ["mqttConnected", "MQTT connected"],
      ["openapiMqttConnected", "OpenAPI MQTT connected"]
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
          def: false
        },
        native: {}
      });
      await this.setStateAsync(`info.${id}`, { val: false, ack: true });
    }
    this.stateManager = new import_state_manager.StateManager(this);
    this.deviceManager = new import_device_manager.DeviceManager(this.log);
    const dataDir = utils.getAbsoluteInstanceDataDir(this);
    this.skuCache = new import_sku_cache.SkuCache(dataDir, this.log);
    this.deviceManager.setSkuCache(this.skuCache);
    this.cloudClient = new import_govee_cloud_client.GoveeCloudClient(config.apiKey, this.log);
    this.deviceManager.setCloudClient(this.cloudClient);
    const timers = {
      setInterval: (cb, ms) => this.setInterval(cb, ms),
      clearInterval: (t) => this.clearInterval(t),
      setTimeout: (cb, ms) => this.setTimeout(cb, ms),
      clearTimeout: (t) => this.clearTimeout(t)
    };
    this.rateLimiter = new import_rate_limiter.RateLimiter(
      this.log,
      timers,
      FULL_LIMITS.perMinute,
      FULL_LIMITS.perDay
    );
    this.rateLimiter.start();
    this.deviceManager.setRateLimiter(this.rateLimiter);
    await this.detectSiblingAdapter();
    this.deviceManager.setOnDeviceUpdate(
      (device, caps) => {
        void this.handleDeviceUpdate(device, caps);
      }
    );
    this.deviceManager.setOnDeviceListChanged((devices) => {
      void this.handleDeviceListChanged(devices);
    });
    this.deviceManager.loadFromCache();
    if (config.goveeEmail && config.goveePassword) {
      this.mqttClient = new import_govee_mqtt_client.GoveeMqttClient(
        config.goveeEmail,
        config.goveePassword,
        this.log,
        timers
      );
      this.appApiClient = new import_govee_app_api_client.GoveeAppApiClient();
      this.deviceManager.setAppApiClient(this.appApiClient);
      void this.mqttClient.connect(
        (update) => this.deviceManager.handleMqttStatus(update),
        (connected) => {
          void this.setStateAsync("info.mqttConnected", {
            val: connected,
            ack: true
          });
        },
        (deviceId, packets) => this.deviceManager.handleRawPackets(deviceId, packets),
        (token) => {
          var _a;
          return (_a = this.appApiClient) == null ? void 0 : _a.setBearerToken(token);
        }
      );
    }
    this.openapiMqttClient = new import_govee_openapi_mqtt_client.GoveeOpenapiMqttClient(
      config.apiKey,
      this.log,
      timers
    );
    this.openapiMqttClient.connect(
      (event) => this.deviceManager.handleOpenApiEvent(event),
      (connected) => {
        void this.setStateAsync("info.openapiMqttConnected", {
          val: connected,
          ack: true
        });
      },
      (rawJson) => this.deviceManager.handleOpenApiRaw(rawJson)
    );
    try {
      await this.deviceManager.loadFromCloud();
      await this.setStateAsync("info.connection", { val: true, ack: true });
      await this.createAllDeviceStates();
      await this.deviceManager.pollDeviceStates();
    } catch (err) {
      this.log.warn(
        `Cloud init failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    this.logReady();
    const pollMs = Math.max(config.pollInterval || 120, 30) * 1e3;
    this.pollTimer = this.setInterval(() => {
      void this.pollCycle();
    }, pollMs);
    if (this.appApiClient) {
      this.appApiPollTimer = this.setInterval(() => {
        void this.appApiPollCycle();
      }, pollMs);
    }
    await this.subscribeStatesAsync("devices.*.control.*");
    await this.subscribeStatesAsync("devices.*.raw.diagnostics_export");
  }
  /** Polling cycle — refresh device states */
  async pollCycle() {
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
  async appApiPollCycle() {
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
  async handleDeviceUpdate(device, caps) {
    if (!this.stateManager) {
      return;
    }
    const values = caps.flatMap((cap) => (0, import_capability_mapper.mapCloudStateValue)(cap));
    await this.stateManager.updateDeviceStates(device, values);
    if (device.lastCloudStateResponse) {
      await this.stateManager.updateRawApiData(
        device,
        JSON.stringify(device.capabilities, null, 2),
        device.lastCloudStateResponse
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
  async handleDeviceListChanged(devices) {
    if (!this.stateManager) {
      return;
    }
    await this.createAllDeviceStates();
    await this.stateManager.cleanupDevices(devices);
  }
  /** Create ioBroker states for all known devices */
  async createAllDeviceStates() {
    if (!this.deviceManager || !this.stateManager) {
      return;
    }
    for (const device of this.deviceManager.getAllDevices()) {
      const stateDefs = (0, import_capability_mapper.buildDeviceStateDefs)(device);
      await this.stateManager.createDeviceStates(device, stateDefs);
      await this.stateManager.updateRawApiData(
        device,
        JSON.stringify(device.capabilities, null, 2)
      );
    }
  }
  /**
   * Handle state change from user (control commands)
   *
   * @param id Identifier string
   * @param state state
   */
  async onStateChange(id, state) {
    if (isSiblingAliveId(id)) {
      const instance = id.replace("system.adapter.", "").replace(/\.alive$/, "");
      if ((state == null ? void 0 : state.val) === true) {
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
    const parts = id.replace(`${this.namespace}.`, "").split(".");
    if (parts.length < 4 || parts[0] !== "devices") {
      return;
    }
    const deviceFolder = parts[1];
    const channel = parts[2];
    const stateId = parts.slice(3).join(".");
    const device = this.deviceManager.getAllDevices().find(
      (d) => this.stateManager.devicePrefix(d) === `devices.${deviceFolder}`
    );
    if (!device) {
      this.log.debug(`State change for unknown device folder: ${deviceFolder}`);
      return;
    }
    if (channel === "raw" && stateId === "diagnostics_export") {
      const diagnostics = this.deviceManager.generateDiagnostics(device);
      const prefix = this.stateManager.devicePrefix(device);
      await this.setStateAsync(`${prefix}.raw.diagnostics_result`, {
        val: diagnostics,
        ack: true
      });
      await this.setStateAsync(`${prefix}.raw.diagnostics_export`, {
        val: false,
        ack: true
      });
      this.log.info(`Diagnostics exported for ${device.sku} (${device.name})`);
      return;
    }
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
  async handleControlCommand(device, deviceFolder, stateId, value) {
    var _a, _b;
    const fullId = `devices.${deviceFolder}.control.${stateId}`;
    const obj = await this.getObjectAsync(fullId);
    if (!((_a = obj == null ? void 0 : obj.native) == null ? void 0 : _a.capabilityType) || !((_b = obj == null ? void 0 : obj.native) == null ? void 0 : _b.capabilityInstance)) {
      this.log.debug(`No capability info for ${fullId}`);
      return;
    }
    const capType = obj.native.capabilityType;
    const capInstance = obj.native.capabilityInstance;
    const apiValue = this.toCloudValue(
      device,
      capType,
      capInstance,
      stateId,
      value
    );
    if (apiValue === void 0) {
      return;
    }
    try {
      await this.deviceManager.sendCommand(
        device,
        capType,
        capInstance,
        apiValue
      );
      this.log.debug(
        `Command sent: ${device.sku} ${capInstance} = ${JSON.stringify(apiValue)}`
      );
    } catch (err) {
      this.log.warn(
        `Command failed for ${device.sku}: ${err instanceof Error ? err.message : String(err)}`
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
  toCloudValue(device, capType, capInstance, stateId, value) {
    var _a, _b;
    const shortType = capType.replace("devices.capabilities.", "");
    switch (shortType) {
      case "on_off":
      case "toggle":
        return value ? 1 : 0;
      case "range":
        return typeof value === "number" ? value : Number(value);
      case "work_mode": {
        if (stateId === "work_mode") {
          const currentModeValue = (_a = device.state.modeValue) != null ? _a : 0;
          return { workMode: Number(value), modeValue: currentModeValue };
        }
        if (stateId === "mode_value") {
          const currentWorkMode = (_b = device.state.workMode) != null ? _b : 1;
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
              `Invalid JSON for mode value on ${device.sku}: ${value.slice(0, 80)}`
            );
            return void 0;
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
  async detectSiblingAdapter() {
    try {
      const instances = await this.getForeignObjectsAsync(
        "system.adapter.govee-smart.*",
        "instance"
      );
      for (const id of Object.keys(instances != null ? instances : {})) {
        const state = await this.getForeignStateAsync(`${id}.alive`);
        if ((state == null ? void 0 : state.val) === true) {
          this.siblingInstancesAlive.add(id.replace("system.adapter.", ""));
        }
      }
      this.applySiblingLimits(this.siblingInstancesAlive.size > 0);
      await this.subscribeForeignStatesAsync(SIBLING_ALIVE_PATTERN);
    } catch {
      this.applySiblingLimits(false);
    }
  }
  /**
   * Apply rate limits based on sibling adapter presence.
   *
   * @param siblingAlive Whether the sibling adapter is running
   */
  applySiblingLimits(siblingAlive) {
    if (!this.rateLimiter || this.siblingActive === siblingAlive) {
      return;
    }
    this.siblingActive = siblingAlive;
    if (siblingAlive) {
      this.rateLimiter.updateLimits(
        SHARED_LIMITS.perMinute,
        SHARED_LIMITS.perDay
      );
      this.log.info(
        `govee-smart detected \u2014 sharing API budget (${SHARED_LIMITS.perMinute}/min, ${SHARED_LIMITS.perDay}/day)`
      );
    } else {
      this.rateLimiter.updateLimits(FULL_LIMITS.perMinute, FULL_LIMITS.perDay);
      this.log.info(
        `govee-smart not active \u2014 using full API budget (${FULL_LIMITS.perMinute}/min, ${FULL_LIMITS.perDay}/day)`
      );
    }
  }
  /** Log ready message with device summary */
  logReady() {
    var _a, _b, _c, _d;
    if (this.readyLogged) {
      return;
    }
    this.readyLogged = true;
    const devices = (_b = (_a = this.deviceManager) == null ? void 0 : _a.getAllDevices()) != null ? _b : [];
    const iotMqtt = this.mqttClient ? "IoT-MQTT" : "";
    const apiMqtt = this.openapiMqttClient ? "OpenAPI-MQTT" : "";
    const channels = ["Cloud", iotMqtt, apiMqtt].filter(Boolean).join(", ");
    if (devices.length === 0) {
      this.log.info(`Ready with channels: ${channels} \u2014 no appliances found`);
    } else {
      const types = /* @__PURE__ */ new Map();
      for (const d of devices) {
        const shortType = ((_c = d.type) != null ? _c : "unknown").replace("devices.types.", "");
        types.set(shortType, ((_d = types.get(shortType)) != null ? _d : 0) + 1);
      }
      const summary = Array.from(types.entries()).map(([t, c]) => `${c}\xD7 ${t}`).join(", ");
      this.log.info(
        `Ready with channels: ${channels} \u2014 ${devices.length} appliances (${summary})`
      );
    }
  }
  /**
   * Adapter stopping — cleanup synchronously
   *
   * @param callback Callback function
   */
  onUnload(callback) {
    var _a, _b, _c;
    try {
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
        this.pollTimer = void 0;
      }
      if (this.appApiPollTimer) {
        this.clearInterval(this.appApiPollTimer);
        this.appApiPollTimer = void 0;
      }
      (_a = this.rateLimiter) == null ? void 0 : _a.stop();
      (_b = this.mqttClient) == null ? void 0 : _b.disconnect();
      (_c = this.openapiMqttClient) == null ? void 0 : _c.disconnect();
      void this.setState("info.connection", { val: false, ack: true });
      void this.setState("info.mqttConnected", { val: false, ack: true });
      void this.setState("info.openapiMqttConnected", {
        val: false,
        ack: true
      });
    } catch {
    }
    callback();
  }
}
if (require.main !== module) {
  module.exports = (options) => new GoveeAppliancesAdapter(options);
} else {
  new GoveeAppliancesAdapter();
}
//# sourceMappingURL=main.js.map
