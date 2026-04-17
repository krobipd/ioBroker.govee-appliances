import type { GoveeCloudClient } from "./govee-cloud-client.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { CachedDeviceData, SkuCache } from "./sku-cache.js";
import {
  classifyError,
  normalizeDeviceId,
  LIGHT_TYPES,
  type ApplianceDevice,
  type CloudDevice,
  type CloudStateCapability,
  type ErrorCategory,
  type MqttStatusUpdate,
  type OpenApiMqttEvent,
} from "./types.js";

/** Max raw MQTT packets to keep per device */
const MAX_RAW_PACKETS = 50;

/** Callback for device state updates */
export type DeviceUpdateCallback = (
  device: ApplianceDevice,
  stateCapabilities: CloudStateCapability[],
) => void;

/** Callback when device list changes */
export type DeviceListCallback = (devices: ApplianceDevice[]) => void;

/**
 * Device manager — maintains unified appliance device list.
 * Handles Cloud API loading, MQTT status updates, and raw packet logging.
 */
export class DeviceManager {
  private readonly log: ioBroker.Logger;
  private readonly devices = new Map<string, ApplianceDevice>();
  private cloudClient: GoveeCloudClient | null = null;
  private rateLimiter: RateLimiter | null = null;
  private skuCache: SkuCache | null = null;
  private onDeviceUpdate: DeviceUpdateCallback | null = null;
  private onDeviceListChanged: DeviceListCallback | null = null;
  private lastErrorCategory: ErrorCategory | null = null;

  /** @param log ioBroker logger */
  constructor(log: ioBroker.Logger) {
    this.log = log;
  }

  /**
   * Set Cloud API client
   *
   * @param client Client instance
   */
  setCloudClient(client: GoveeCloudClient): void {
    this.cloudClient = client;
  }

  /**
   * Set rate limiter
   *
   * @param limiter Rate limiter instance
   */
  setRateLimiter(limiter: RateLimiter): void {
    this.rateLimiter = limiter;
  }

  /**
   * Set SKU cache
   *
   * @param cache SKU cache instance
   */
  setSkuCache(cache: SkuCache): void {
    this.skuCache = cache;
  }

  /**
   * Set callback for device state updates
   *
   * @param callback Callback function
   */
  setOnDeviceUpdate(callback: DeviceUpdateCallback): void {
    this.onDeviceUpdate = callback;
  }

  /**
   * Set callback for device list changes
   *
   * @param callback Callback function
   */
  setOnDeviceListChanged(callback: DeviceListCallback): void {
    this.onDeviceListChanged = callback;
  }

  /** Get all devices */
  getAllDevices(): ApplianceDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get device by normalized ID
   *
   * @param deviceId Device identifier
   */
  getDevice(deviceId: string): ApplianceDevice | undefined {
    return this.devices.get(normalizeDeviceId(deviceId));
  }

  /**
   * Load devices from SKU cache (fast startup without Cloud calls).
   */
  loadFromCache(): void {
    if (!this.skuCache) {
      return;
    }

    const cached = this.skuCache.loadAll();
    let loaded = 0;
    for (const data of cached) {
      const key = normalizeDeviceId(data.deviceId);
      if (!this.devices.has(key)) {
        this.devices.set(key, {
          sku: data.sku,
          deviceId: data.deviceId,
          name: data.name,
          type: data.type,
          capabilities: data.capabilities,
          state: data.lastState,
          online: false,
          lastCloudStateResponse: "",
          rawMqttPackets: [],
          rawMqttPacketCount: 0,
          rawOpenapiEvents: [],
          rawOpenapiEventCount: 0,
        });
        loaded++;
      }
    }
    if (loaded > 0) {
      this.log.debug(`Loaded ${loaded} devices from cache`);
    }
  }

  /**
   * Load device list from Cloud API.
   * Filters out light devices — those belong to govee-smart.
   */
  async loadFromCloud(): Promise<void> {
    if (!this.cloudClient) {
      return;
    }

    try {
      this.rateLimiter?.recordCall();
      const cloudDevices = await this.cloudClient.getDevices();
      const appliances = cloudDevices.filter(
        (d) => !LIGHT_TYPES.includes(d.type),
      );

      this.log.debug(
        `Cloud: ${cloudDevices.length} devices total, ${appliances.length} appliances`,
      );

      let newCount = 0;
      for (const cd of appliances) {
        const key = normalizeDeviceId(cd.device);
        const existing = this.devices.get(key);
        let changed = false;

        if (existing) {
          if (
            existing.name !== cd.deviceName ||
            existing.type !== cd.type ||
            JSON.stringify(existing.capabilities) !==
              JSON.stringify(cd.capabilities)
          ) {
            existing.name = cd.deviceName;
            existing.type = cd.type;
            existing.capabilities = cd.capabilities;
            changed = true;
          }
        } else {
          this.devices.set(key, this.cloudToDevice(cd));
          newCount++;
          changed = true;
        }

        if (changed) {
          this.cacheDevice(key);
        }
      }

      if (newCount > 0) {
        this.log.debug(`Cloud: ${newCount} new appliances discovered`);
      }

      if (this.lastErrorCategory) {
        this.log.info("Cloud API connection restored");
        this.lastErrorCategory = null;
      }

      this.onDeviceListChanged?.(this.getAllDevices());
    } catch (err) {
      const category = classifyError(err);
      const msg = `Cloud API error: ${err instanceof Error ? err.message : String(err)}`;

      if (category !== this.lastErrorCategory) {
        this.lastErrorCategory = category;
        this.log.warn(msg);
      } else {
        this.log.debug(msg);
      }
    }
  }

  /**
   * Poll state for all devices via Cloud API.
   * Rate-limited to avoid hitting API limits.
   */
  async pollDeviceStates(): Promise<void> {
    if (!this.cloudClient || !this.rateLimiter) {
      return;
    }

    for (const device of this.devices.values()) {
      const client = this.cloudClient;
      const rl = this.rateLimiter;

      await rl.tryExecute(async () => {
        try {
          const caps = await client.getDeviceState(device.sku, device.deviceId);
          this.applyCloudState(device, caps);
        } catch (err) {
          this.log.debug(
            `State poll failed for ${device.sku}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    }
  }

  /**
   * Handle MQTT status update for a device.
   * Stores raw state internally; we don't translate MQTT keys to ioBroker
   * states because the MQTT payload format isn't documented for appliances.
   * Cloud polling remains the source of truth for state values.
   *
   * @param update MQTT status update
   */
  handleMqttStatus(update: MqttStatusUpdate): void {
    const device = this.devices.get(normalizeDeviceId(update.device));
    if (!device) {
      this.log.debug(
        `MQTT status for unknown device: ${update.sku} ${update.device}`,
      );
      return;
    }

    if (update.state) {
      Object.assign(device.state, update.state);
    }
  }

  /**
   * Handle OpenAPI MQTT event (sensor events like lackWater, iceFull).
   * These arrive via mqtt.openapi.govee.com and contain capability-format data.
   *
   * @param event OpenAPI MQTT event
   */
  handleOpenApiEvent(event: OpenApiMqttEvent): void {
    const key = normalizeDeviceId(event.device);
    const device = this.devices.get(key);
    if (!device) {
      this.log.debug(
        `OpenAPI MQTT event for unknown device: ${event.sku} ${event.device}`,
      );
      return;
    }

    // Events arrive in capability format — forward directly
    if (event.capabilities.length > 0) {
      this.onDeviceUpdate?.(device, event.capabilities);
    }
  }

  /**
   * Store raw OpenAPI MQTT message for diagnostics.
   *
   * @param rawJson Raw JSON string from the MQTT message
   */
  handleOpenApiRaw(rawJson: string): void {
    // Try to extract device ID to attach to specific device
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const deviceId = (parsed.device as string) ?? "";
      if (deviceId) {
        const key = normalizeDeviceId(deviceId);
        const device = this.devices.get(key);
        if (device) {
          device.rawOpenapiEvents.push({
            timestamp: Date.now(),
            data: rawJson,
          });
          while (device.rawOpenapiEvents.length > MAX_RAW_PACKETS) {
            device.rawOpenapiEvents.shift();
          }
          device.rawOpenapiEventCount++;
          return;
        }
      }
    } catch {
      // ignore parse errors — the raw string is still logged above
    }
  }

  /**
   * Store raw BLE packets from MQTT for research.
   *
   * @param deviceId Device identifier
   * @param packets BLE packet data
   */
  handleRawPackets(deviceId: string, packets: string[]): void {
    const key = normalizeDeviceId(deviceId);
    const device = this.devices.get(key);
    if (!device) {
      return;
    }

    device.rawMqttPackets.push({
      timestamp: Date.now(),
      packets,
    });

    // Ring buffer — keep last N
    while (device.rawMqttPackets.length > MAX_RAW_PACKETS) {
      device.rawMqttPackets.shift();
    }

    device.rawMqttPacketCount += packets.length;
  }

  /**
   * Send a control command to a device via Cloud API.
   *
   * @param device Appliance device
   * @param capabilityType Capability type string
   * @param instance Capability instance name
   * @param value Value to send
   */
  async sendCommand(
    device: ApplianceDevice,
    capabilityType: string,
    instance: string,
    value: unknown,
  ): Promise<void> {
    if (!this.cloudClient || !this.rateLimiter) {
      this.log.warn("Cannot send command — Cloud API not initialized");
      return;
    }

    const client = this.cloudClient;
    const executed = await this.rateLimiter.tryExecute(async () => {
      await client.controlDevice(
        device.sku,
        device.deviceId,
        capabilityType,
        instance,
        value,
      );
    });

    if (!executed) {
      this.log.debug(`Command queued for ${device.sku} (rate limited)`);
    }
  }

  /**
   * Generate diagnostics JSON for a device.
   *
   * @param device Appliance device
   */
  generateDiagnostics(device: ApplianceDevice): string {
    return JSON.stringify(
      {
        sku: device.sku,
        deviceId: device.deviceId,
        name: device.name,
        type: device.type,
        online: device.online,
        capabilities: device.capabilities,
        currentState: device.state,
        lastCloudStateResponse: device.lastCloudStateResponse
          ? "(set)"
          : "(empty)",
        iotMqtt: {
          packetCount: device.rawMqttPacketCount,
          lastPackets: device.rawMqttPackets.slice(-10),
        },
        openapiMqtt: {
          eventCount: device.rawOpenapiEventCount,
          lastEvents: device.rawOpenapiEvents.slice(-10),
        },
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    );
  }

  /**
   * Apply Cloud state response to a device.
   *
   * @param device Appliance device
   * @param caps State capabilities
   */
  private applyCloudState(
    device: ApplianceDevice,
    caps: CloudStateCapability[],
  ): void {
    // Store raw response for diagnostics
    device.lastCloudStateResponse = JSON.stringify(caps, null, 2);

    for (const cap of caps) {
      if (cap.type.endsWith("online")) {
        device.online = cap.state?.value === true || cap.state?.value === 1;
      }
      // Store raw state value
      device.state[cap.instance] = cap.state?.value;
    }

    this.onDeviceUpdate?.(device, caps);
  }

  /**
   * Convert Cloud API device to internal device model.
   *
   * @param cd Cloud device data
   */
  private cloudToDevice(cd: CloudDevice): ApplianceDevice {
    return {
      sku: cd.sku,
      deviceId: cd.device,
      name: cd.deviceName,
      type: cd.type,
      capabilities: cd.capabilities,
      state: {},
      online: false,
      lastCloudStateResponse: "",
      rawMqttPackets: [],
      rawMqttPacketCount: 0,
      rawOpenapiEvents: [],
      rawOpenapiEventCount: 0,
    };
  }

  /**
   * Cache device data to persistent storage.
   *
   * @param key Device key
   */
  private cacheDevice(key: string): void {
    if (!this.skuCache) {
      return;
    }
    const device = this.devices.get(key);
    if (!device) {
      return;
    }

    const data: CachedDeviceData = {
      sku: device.sku,
      deviceId: device.deviceId,
      name: device.name,
      type: device.type,
      capabilities: device.capabilities,
      lastState: device.state,
      cachedAt: Date.now(),
    };
    this.skuCache.save(data);
  }
}
