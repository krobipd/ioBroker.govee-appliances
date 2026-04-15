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
var state_manager_exports = {};
__export(state_manager_exports, {
  StateManager: () => StateManager
});
module.exports = __toCommonJS(state_manager_exports);
var import_types = require("./types.js");
const MANAGED_CHANNELS = ["control", "sensor", "events", "raw"];
const CHANNEL_NAMES = {
  control: "Controls",
  sensor: "Sensors",
  events: "Events",
  raw: "Raw Data & Diagnostics"
};
class StateManager {
  adapter;
  /** Maps "prefix.stateId" → channel name (populated during createDeviceStates) */
  stateChannelMap = /* @__PURE__ */ new Map();
  /** @param adapter The ioBroker adapter instance */
  constructor(adapter) {
    this.adapter = adapter;
  }
  /**
   * Resolve full state path for a given device prefix and state ID.
   * Routes the state to the correct channel (control, sensor, events, raw).
   *
   * @param prefix Device object ID prefix
   * @param stateId State ID suffix
   */
  resolveStatePath(prefix, stateId) {
    var _a;
    const channel = (_a = this.stateChannelMap.get(`${prefix}.${stateId}`)) != null ? _a : "control";
    return `${prefix}.${channel}.${stateId}`;
  }
  /**
   * Create device object and all states from capability definitions.
   *
   * @param device Appliance device
   * @param stateDefs State definitions from capability mapper
   */
  async createDeviceStates(device, stateDefs) {
    var _a, _b;
    const prefix = this.devicePrefix(device);
    await this.adapter.extendObjectAsync(prefix, {
      type: "device",
      common: {
        name: device.name,
        statusStates: {
          onlineId: `${this.adapter.namespace}.${prefix}.info.online`
        }
      },
      native: {
        sku: device.sku,
        deviceId: device.deviceId
      }
    });
    await this.adapter.extendObjectAsync(`${prefix}.info`, {
      type: "channel",
      common: { name: "Device Information" },
      native: {}
    });
    await this.ensureState(
      `${prefix}.info.name`,
      "Name",
      "string",
      "text",
      false
    );
    await this.adapter.setStateAsync(`${prefix}.info.name`, {
      val: device.name,
      ack: true
    });
    await this.ensureState(
      `${prefix}.info.model`,
      "Model",
      "string",
      "text",
      false
    );
    await this.adapter.setStateAsync(`${prefix}.info.model`, {
      val: device.sku,
      ack: true
    });
    await this.ensureState(
      `${prefix}.info.online`,
      "Online",
      "boolean",
      "indicator.reachable",
      false
    );
    await this.adapter.setStateAsync(`${prefix}.info.online`, {
      val: device.online,
      ack: true
    });
    const channelGroups = /* @__PURE__ */ new Map();
    for (const def of stateDefs) {
      const channel = (_a = def.channel) != null ? _a : "control";
      this.stateChannelMap.set(`${prefix}.${def.id}`, channel);
      if (!channelGroups.has(channel)) {
        channelGroups.set(channel, []);
      }
      channelGroups.get(channel).push(def);
    }
    this.adapter.log.debug(
      `createDeviceStates ${device.sku}: ${stateDefs.length} states in ${channelGroups.size} channel(s)`
    );
    for (const [channel, defs] of channelGroups) {
      await this.adapter.extendObjectAsync(`${prefix}.${channel}`, {
        type: "channel",
        common: { name: (_b = CHANNEL_NAMES[channel]) != null ? _b : channel },
        native: {}
      });
      for (const def of defs) {
        const common = {
          name: def.name,
          type: def.type,
          role: def.role,
          read: true,
          write: def.write
        };
        if (def.unit) {
          common.unit = def.unit;
        }
        if (def.min !== void 0) {
          common.min = def.min;
        }
        if (def.max !== void 0) {
          common.max = def.max;
        }
        if (def.states) {
          common.states = def.states;
        }
        if (def.def !== void 0) {
          common.def = def.def;
        }
        await this.adapter.extendObjectAsync(`${prefix}.${channel}.${def.id}`, {
          type: "state",
          common,
          native: {
            capabilityType: def.capabilityType,
            capabilityInstance: def.capabilityInstance
          }
        });
        if (def.def !== void 0) {
          const current = await this.adapter.getStateAsync(
            `${prefix}.${channel}.${def.id}`
          );
          if (!current || current.val === null || current.val === void 0) {
            await this.adapter.setStateAsync(`${prefix}.${channel}.${def.id}`, {
              val: def.def,
              ack: true
            });
          } else if (def.states && !(String(current.val) in def.states)) {
            await this.adapter.setStateAsync(`${prefix}.${channel}.${def.id}`, {
              val: def.def,
              ack: true
            });
          }
        }
      }
    }
    await this.cleanupAllChannelStates(prefix, stateDefs);
  }
  /**
   * Update device states from Cloud API state response.
   *
   * @param device Appliance device
   * @param values Mapped state values from capability mapper
   */
  async updateDeviceStates(device, values) {
    const prefix = this.devicePrefix(device);
    for (const v of values) {
      if (v.stateId === "online") {
        await this.setStateIfExists(`${prefix}.info.online`, v.value);
        continue;
      }
      const fullPath = this.resolveStatePath(prefix, v.stateId);
      await this.setStateIfExists(fullPath, v.value);
    }
  }
  /**
   * Update the online state for a device.
   *
   * @param device Appliance device
   * @param online Online status
   */
  async updateOnline(device, online) {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(`${prefix}.info.online`, online);
  }
  /**
   * Update raw MQTT packet data for a device.
   *
   * @param device Appliance device
   */
  async updateRawMqttData(device) {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(
      `${prefix}.raw.mqttLastPackets`,
      JSON.stringify(device.rawMqttPackets)
    );
    await this.setStateIfExists(
      `${prefix}.raw.mqttPacketCount`,
      device.rawMqttPacketCount
    );
  }
  /**
   * Update raw API data for a device.
   *
   * @param device Appliance device
   * @param capabilities JSON string of capabilities
   * @param stateResponse JSON string of last state response
   */
  async updateRawApiData(device, capabilities, stateResponse) {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(`${prefix}.raw.apiCapabilities`, capabilities);
    if (stateResponse !== void 0) {
      await this.setStateIfExists(
        `${prefix}.raw.apiLastStateResponse`,
        stateResponse
      );
    }
  }
  /**
   * Update raw OpenAPI MQTT event data for a device.
   *
   * @param device Appliance device
   */
  async updateRawOpenapiData(device) {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(
      `${prefix}.raw.openapiLastEvents`,
      JSON.stringify(device.rawOpenapiEvents)
    );
    await this.setStateIfExists(
      `${prefix}.raw.openapiEventCount`,
      device.rawOpenapiEventCount
    );
  }
  /**
   * Cleanup stale devices that no longer exist.
   *
   * @param currentDevices Current device list
   */
  async cleanupDevices(currentDevices) {
    const currentPrefixes = new Set(
      currentDevices.map((d) => this.devicePrefix(d))
    );
    const existingObjects = await this.adapter.getObjectViewAsync(
      "system",
      "device",
      {
        startkey: `${this.adapter.namespace}.devices.`,
        endkey: `${this.adapter.namespace}.devices.\u9999`
      }
    );
    if (!(existingObjects == null ? void 0 : existingObjects.rows)) {
      return;
    }
    for (const row of existingObjects.rows) {
      const localId = row.id.replace(`${this.adapter.namespace}.`, "");
      if (!currentPrefixes.has(localId)) {
        this.adapter.log.debug(`Removing stale device: ${localId}`);
        await this.adapter.delObjectAsync(localId, { recursive: true });
      }
    }
  }
  /**
   * Get device object ID prefix — stable SKU + short device ID.
   *
   * @param device Appliance device
   */
  devicePrefix(device) {
    return `devices.${(0, import_types.devicePrefix)(device.sku, device.deviceId)}`;
  }
  /**
   * Remove stale states across all managed channels.
   *
   * @param prefix Device object ID prefix
   * @param stateDefs State definitions from capability mapper
   */
  async cleanupAllChannelStates(prefix, stateDefs) {
    var _a, _b;
    const expectedByChannel = /* @__PURE__ */ new Map();
    for (const def of stateDefs) {
      const channel = (_a = def.channel) != null ? _a : "control";
      if (!expectedByChannel.has(channel)) {
        expectedByChannel.set(channel, /* @__PURE__ */ new Set());
      }
      expectedByChannel.get(channel).add(def.id);
    }
    for (const channel of MANAGED_CHANNELS) {
      const channelPrefix = `${this.adapter.namespace}.${prefix}.${channel}.`;
      const existing = await this.adapter.getObjectViewAsync(
        "system",
        "state",
        {
          startkey: channelPrefix,
          endkey: `${channelPrefix}\u9999`
        }
      );
      if (!(existing == null ? void 0 : existing.rows)) {
        continue;
      }
      const validIds = (_b = expectedByChannel.get(channel)) != null ? _b : /* @__PURE__ */ new Set();
      let deleted = 0;
      for (const row of existing.rows) {
        const stateId = row.id.replace(channelPrefix, "");
        if (!validIds.has(stateId)) {
          const localId = row.id.replace(`${this.adapter.namespace}.`, "");
          this.adapter.log.debug(`Removing stale state: ${localId}`);
          await this.adapter.delObjectAsync(localId);
          await this.adapter.delStateAsync(localId).catch(() => {
          });
          deleted++;
        }
      }
      if (deleted > 0 && deleted === existing.rows.length) {
        this.adapter.log.debug(`Removing empty channel: ${prefix}.${channel}`);
        await this.adapter.delObjectAsync(`${prefix}.${channel}`).catch(() => {
        });
      }
    }
  }
  /**
   * Create a state if it doesn't exist
   *
   * @param id Identifier string
   * @param name name
   * @param type type
   * @param role role
   * @param write write
   */
  async ensureState(id, name, type, role, write) {
    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: { name, type, role, read: true, write },
      native: {}
    });
  }
  /**
   * Set state value only if the object exists
   *
   * @param id Identifier string
   * @param value Value to send
   */
  async setStateIfExists(id, value) {
    const obj = await this.adapter.getObjectAsync(id);
    if (obj) {
      await this.adapter.setStateAsync(id, { val: value, ack: true });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StateManager
});
//# sourceMappingURL=state-manager.js.map
