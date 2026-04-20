"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var device_manager_exports = {};
__export(device_manager_exports, {
  DeviceManager: () => DeviceManager,
  buildCapabilitiesFromAppEntry: () => buildCapabilitiesFromAppEntry
});
module.exports = __toCommonJS(device_manager_exports);
var import_types = require("./types.js");
const MAX_RAW_PACKETS = 50;
class DeviceManager {
  log;
  devices = /* @__PURE__ */ new Map();
  cloudClient = null;
  appApiClient = null;
  rateLimiter = null;
  skuCache = null;
  onDeviceUpdate = null;
  onDeviceListChanged = null;
  lastErrorCategory = null;
  /** @param log ioBroker logger */
  constructor(log) {
    this.log = log;
  }
  /**
   * Set Cloud API client
   *
   * @param client Client instance
   */
  setCloudClient(client) {
    this.cloudClient = client;
  }
  /**
   * Set rate limiter
   *
   * @param limiter Rate limiter instance
   */
  setRateLimiter(limiter) {
    this.rateLimiter = limiter;
  }
  /**
   * Set the app-API client. This is the undocumented `app2.govee.com` API
   * that exposes sensor values which the OpenAPI v2 `/device/state` endpoint
   * leaves empty for devices like the H5179 thermometer.
   *
   * @param client App-API client instance
   */
  setAppApiClient(client) {
    this.appApiClient = client;
  }
  /**
   * Set SKU cache
   *
   * @param cache SKU cache instance
   */
  setSkuCache(cache) {
    this.skuCache = cache;
  }
  /**
   * Set callback for device state updates
   *
   * @param callback Callback function
   */
  setOnDeviceUpdate(callback) {
    this.onDeviceUpdate = callback;
  }
  /**
   * Set callback for device list changes
   *
   * @param callback Callback function
   */
  setOnDeviceListChanged(callback) {
    this.onDeviceListChanged = callback;
  }
  /** Get all devices */
  getAllDevices() {
    return Array.from(this.devices.values());
  }
  /**
   * Get device by normalized ID
   *
   * @param deviceId Device identifier
   */
  getDevice(deviceId) {
    return this.devices.get((0, import_types.normalizeDeviceId)(deviceId));
  }
  /**
   * Load devices from SKU cache (fast startup without Cloud calls).
   */
  loadFromCache() {
    if (!this.skuCache) {
      return;
    }
    const cached = this.skuCache.loadAll();
    let loaded = 0;
    for (const data of cached) {
      const key = (0, import_types.normalizeDeviceId)(data.deviceId);
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
          rawOpenapiEventCount: 0
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
  async loadFromCloud() {
    var _a, _b;
    if (!this.cloudClient) {
      return;
    }
    try {
      (_a = this.rateLimiter) == null ? void 0 : _a.recordCall();
      const cloudDevices = await this.cloudClient.getDevices();
      const appliances = cloudDevices.filter(
        (d) => typeof (d == null ? void 0 : d.type) === "string" && typeof d.device === "string" && d.type.startsWith("devices.types.") && !import_types.LIGHT_TYPES.includes(d.type)
      );
      this.log.debug(
        `Cloud: ${cloudDevices.length} devices total, ${appliances.length} appliances`
      );
      let newCount = 0;
      for (const cd of appliances) {
        const key = (0, import_types.normalizeDeviceId)(cd.device);
        const existing = this.devices.get(key);
        let changed = false;
        if (existing) {
          if (existing.name !== cd.deviceName || existing.type !== cd.type || JSON.stringify(existing.capabilities) !== JSON.stringify(cd.capabilities)) {
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
      (_b = this.onDeviceListChanged) == null ? void 0 : _b.call(this, this.getAllDevices());
    } catch (err) {
      const category = (0, import_types.classifyError)(err);
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
   * Poll the undocumented app-API for devices that the OpenAPI `/device/state`
   * endpoint doesn't expose. One call returns every device on the account
   * with `lastDeviceData` (temperature, humidity, online, battery) embedded —
   * cheap enough to run on a 2-minute cadence without risking rate limits.
   *
   * Per-device-matched entries synthesize `CloudStateCapability` objects so
   * the existing state-update path can consume them without a new branch.
   */
  async pollAppApi() {
    if (!this.appApiClient || !this.appApiClient.hasBearerToken()) {
      return;
    }
    let entries;
    try {
      entries = await this.appApiClient.fetchDeviceList();
    } catch (err) {
      const category = (0, import_types.classifyError)(err);
      const msg = `App API fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      if (category !== this.lastErrorCategory) {
        this.lastErrorCategory = category;
        this.log.warn(msg);
      } else {
        this.log.debug(msg);
      }
      return;
    }
    for (const entry of entries) {
      const device = this.devices.get((0, import_types.normalizeDeviceId)(entry.device));
      if (!device) {
        continue;
      }
      const caps = buildCapabilitiesFromAppEntry(entry);
      if (caps.length > 0) {
        this.applyCloudState(device, caps);
      }
      if (entry.lastData || entry.settings) {
        device.appLastData = entry.lastData;
        device.appSettings = entry.settings;
      }
    }
  }
  /**
   * Poll state for all devices via Cloud API.
   * Rate-limited to avoid hitting API limits.
   */
  async pollDeviceStates() {
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
            `State poll failed for ${device.sku}: ${err instanceof Error ? err.message : String(err)}`
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
  handleMqttStatus(update) {
    const device = this.devices.get((0, import_types.normalizeDeviceId)(update.device));
    if (!device) {
      this.log.debug(
        `MQTT status for unknown device: ${update.sku} ${update.device}`
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
  handleOpenApiEvent(event) {
    var _a;
    const key = (0, import_types.normalizeDeviceId)(event.device);
    const device = this.devices.get(key);
    if (!device) {
      this.log.debug(
        `OpenAPI MQTT event for unknown device: ${event.sku} ${event.device}`
      );
      return;
    }
    if (event.capabilities.length > 0) {
      (_a = this.onDeviceUpdate) == null ? void 0 : _a.call(this, device, event.capabilities);
    }
  }
  /**
   * Store raw OpenAPI MQTT message for diagnostics.
   *
   * @param rawJson Raw JSON string from the MQTT message
   */
  handleOpenApiRaw(rawJson) {
    var _a;
    try {
      const parsed = JSON.parse(rawJson);
      const deviceId = (_a = parsed.device) != null ? _a : "";
      if (deviceId) {
        const key = (0, import_types.normalizeDeviceId)(deviceId);
        const device = this.devices.get(key);
        if (device) {
          device.rawOpenapiEvents.push({
            timestamp: Date.now(),
            data: rawJson
          });
          while (device.rawOpenapiEvents.length > MAX_RAW_PACKETS) {
            device.rawOpenapiEvents.shift();
          }
          device.rawOpenapiEventCount++;
          return;
        }
      }
    } catch {
    }
  }
  /**
   * Store raw BLE packets from MQTT for research.
   *
   * @param deviceId Device identifier
   * @param packets BLE packet data
   */
  handleRawPackets(deviceId, packets) {
    const key = (0, import_types.normalizeDeviceId)(deviceId);
    const device = this.devices.get(key);
    if (!device) {
      return;
    }
    device.rawMqttPackets.push({
      timestamp: Date.now(),
      packets
    });
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
  async sendCommand(device, capabilityType, instance, value) {
    if (!this.cloudClient || !this.rateLimiter) {
      this.log.warn("Cannot send command \u2014 Cloud API not initialized");
      return;
    }
    const client = this.cloudClient;
    const executed = await this.rateLimiter.tryExecute(async () => {
      await client.controlDevice(
        device.sku,
        device.deviceId,
        capabilityType,
        instance,
        value
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
  generateDiagnostics(device) {
    return JSON.stringify(
      {
        sku: device.sku,
        deviceId: device.deviceId,
        name: device.name,
        type: device.type,
        online: device.online,
        capabilities: device.capabilities,
        currentState: device.state,
        lastCloudStateResponse: device.lastCloudStateResponse ? "(set)" : "(empty)",
        iotMqtt: {
          packetCount: device.rawMqttPacketCount,
          lastPackets: device.rawMqttPackets.slice(-10)
        },
        openapiMqtt: {
          eventCount: device.rawOpenapiEventCount,
          lastEvents: device.rawOpenapiEvents.slice(-10)
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      null,
      2
    );
  }
  /**
   * Apply Cloud state response to a device.
   *
   * @param device Appliance device
   * @param caps State capabilities
   */
  applyCloudState(device, caps) {
    var _a, _b, _c, _d;
    device.lastCloudStateResponse = JSON.stringify(caps, null, 2);
    for (const cap of caps) {
      if (cap.type.endsWith("online")) {
        device.online = ((_a = cap.state) == null ? void 0 : _a.value) === true || ((_b = cap.state) == null ? void 0 : _b.value) === 1;
      }
      device.state[cap.instance] = (_c = cap.state) == null ? void 0 : _c.value;
    }
    (_d = this.onDeviceUpdate) == null ? void 0 : _d.call(this, device, caps);
  }
  /**
   * Convert Cloud API device to internal device model.
   *
   * @param cd Cloud device data
   */
  cloudToDevice(cd) {
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
      rawOpenapiEventCount: 0
    };
  }
  /**
   * Cache device data to persistent storage.
   *
   * @param key Device key
   */
  cacheDevice(key) {
    if (!this.skuCache) {
      return;
    }
    const device = this.devices.get(key);
    if (!device) {
      return;
    }
    const data = {
      sku: device.sku,
      deviceId: device.deviceId,
      name: device.name,
      type: device.type,
      capabilities: device.capabilities,
      lastState: device.state,
      cachedAt: Date.now()
    };
    this.skuCache.save(data);
  }
}
function buildCapabilitiesFromAppEntry(entry) {
  const caps = [];
  const last = entry.lastData;
  if (!last) {
    return caps;
  }
  if (typeof last.online === "boolean") {
    caps.push({
      type: "devices.capabilities.online",
      instance: "online",
      state: { value: last.online }
    });
  }
  if (typeof last.tem === "number" && Number.isFinite(last.tem)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "sensorTemperature",
      state: { value: last.tem / 100 }
    });
  }
  if (typeof last.hum === "number" && Number.isFinite(last.hum)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "sensorHumidity",
      state: { value: last.hum / 100 }
    });
  }
  if (typeof last.battery === "number" && Number.isFinite(last.battery)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "battery",
      state: { value: last.battery }
    });
  } else if (entry.settings && typeof entry.settings.battery === "number" && Number.isFinite(entry.settings.battery)) {
    caps.push({
      type: "devices.capabilities.property",
      instance: "battery",
      state: { value: entry.settings.battery }
    });
  }
  return caps;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeviceManager,
  buildCapabilitiesFromAppEntry
});
//# sourceMappingURL=device-manager.js.map
