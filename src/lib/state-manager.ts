import type * as utils from "@iobroker/adapter-core";
import type { StateDefinition, CloudStateValue } from "./capability-mapper.js";
import type { ApplianceDevice } from "./types.js";
import { devicePrefix as buildDevicePrefix } from "./types.js";

/** All managed channels (for cleanup of stale states) */
const MANAGED_CHANNELS = ["control", "sensor", "events", "raw"];
/** Channel display names */
const CHANNEL_NAMES: Record<string, string> = {
  control: "Controls",
  sensor: "Sensors",
  events: "Events",
  raw: "Raw Data & Diagnostics",
};

/** Manages ioBroker state creation and updates for appliance devices */
export class StateManager {
  private readonly adapter: utils.AdapterInstance;
  /** Maps "prefix.stateId" → channel name (populated during createDeviceStates) */
  private readonly stateChannelMap = new Map<string, string>();
  /** Local IDs of states known to exist (avoids per-update getObjectAsync) */
  private readonly knownStates = new Set<string>();

  /** @param adapter The ioBroker adapter instance */
  constructor(adapter: utils.AdapterInstance) {
    this.adapter = adapter;
  }

  /**
   * Resolve full state path for a given device prefix and state ID.
   * Routes the state to the correct channel (control, sensor, events, raw).
   *
   * @param prefix Device object ID prefix
   * @param stateId State ID suffix
   */
  resolveStatePath(prefix: string, stateId: string): string {
    const channel =
      this.stateChannelMap.get(`${prefix}.${stateId}`) ?? "control";
    return `${prefix}.${channel}.${stateId}`;
  }

  /**
   * Create device object and all states from capability definitions.
   *
   * @param device Appliance device
   * @param stateDefs State definitions from capability mapper
   */
  async createDeviceStates(
    device: ApplianceDevice,
    stateDefs: StateDefinition[],
  ): Promise<void> {
    const prefix = this.devicePrefix(device);

    // Info channel + states first — referenced by statusStates.onlineId below
    await this.adapter.extendObjectAsync(`${prefix}.info`, {
      type: "channel",
      common: { name: "Device Information" },
      native: {},
    });

    await this.ensureState(
      `${prefix}.info.name`,
      "Name",
      "string",
      "text",
      false,
    );
    await this.adapter.setStateAsync(`${prefix}.info.name`, {
      val: device.name,
      ack: true,
    });

    await this.ensureState(
      `${prefix}.info.model`,
      "Model",
      "string",
      "text",
      false,
    );
    await this.adapter.setStateAsync(`${prefix}.info.model`, {
      val: device.sku,
      ack: true,
    });

    await this.ensureState(
      `${prefix}.info.online`,
      "Online",
      "boolean",
      "indicator.reachable",
      false,
    );
    await this.adapter.setStateAsync(`${prefix}.info.online`, {
      val: device.online,
      ack: true,
    });

    // Device object — info.online now exists when statusStates references it
    await this.adapter.extendObjectAsync(prefix, {
      type: "device",
      common: {
        name: device.name,
        statusStates: {
          onlineId: `${this.adapter.namespace}.${prefix}.info.online`,
        },
      } as ioBroker.DeviceCommon,
      native: {
        sku: device.sku,
        deviceId: device.deviceId,
      },
    });

    // Group state defs by channel
    const channelGroups = new Map<string, StateDefinition[]>();
    for (const def of stateDefs) {
      const channel = def.channel ?? "control";
      this.stateChannelMap.set(`${prefix}.${def.id}`, channel);
      if (!channelGroups.has(channel)) {
        channelGroups.set(channel, []);
      }
      channelGroups.get(channel)!.push(def);
    }

    this.adapter.log.debug(
      `createDeviceStates ${device.sku}: ${stateDefs.length} states in ${channelGroups.size} channel(s)`,
    );

    // Create states in each channel
    for (const [channel, defs] of channelGroups) {
      await this.adapter.extendObjectAsync(`${prefix}.${channel}`, {
        type: "channel",
        common: { name: CHANNEL_NAMES[channel] ?? channel },
        native: {},
      });

      for (const def of defs) {
        const common: Partial<ioBroker.StateCommon> = {
          name: def.name,
          type: def.type,
          role: def.role,
          read: true,
          write: def.write,
        };

        if (def.unit) {
          common.unit = def.unit;
        }
        if (def.min !== undefined) {
          common.min = def.min;
        }
        if (def.max !== undefined) {
          common.max = def.max;
        }
        if (def.states) {
          common.states = def.states;
        }
        if (def.def !== undefined) {
          common.def = def.def;
        }

        const fullId = `${prefix}.${channel}.${def.id}`;
        await this.adapter.extendObjectAsync(fullId, {
          type: "state",
          common: common as ioBroker.StateCommon,
          native: {
            capabilityType: def.capabilityType,
            capabilityInstance: def.capabilityInstance,
          },
        });
        this.knownStates.add(fullId);

        // Initialize state with default value if not yet set
        if (def.def !== undefined) {
          const current = await this.adapter.getStateAsync(
            `${prefix}.${channel}.${def.id}`,
          );
          if (!current || current.val === null || current.val === undefined) {
            await this.adapter.setStateAsync(`${prefix}.${channel}.${def.id}`, {
              val: def.def,
              ack: true,
            });
          } else if (def.states && !(String(current.val) in def.states)) {
            // Reset dropdown to default if current value is stale
            await this.adapter.setStateAsync(`${prefix}.${channel}.${def.id}`, {
              val: def.def,
              ack: true,
            });
          }
        }
      }
    }

    // Remove stale states
    await this.cleanupAllChannelStates(prefix, stateDefs);
  }

  /**
   * Update device states from Cloud API state response.
   *
   * @param device Appliance device
   * @param values Mapped state values from capability mapper
   */
  async updateDeviceStates(
    device: ApplianceDevice,
    values: CloudStateValue[],
  ): Promise<void> {
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
   * Update raw MQTT packet data for a device.
   *
   * @param device Appliance device
   */
  async updateRawMqttData(device: ApplianceDevice): Promise<void> {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(
      `${prefix}.raw.mqttLastPackets`,
      JSON.stringify(device.rawMqttPackets),
    );
    await this.setStateIfExists(
      `${prefix}.raw.mqttPacketCount`,
      device.rawMqttPacketCount,
    );
  }

  /**
   * Update raw API data for a device.
   *
   * @param device Appliance device
   * @param capabilities JSON string of capabilities
   * @param stateResponse JSON string of last state response
   */
  async updateRawApiData(
    device: ApplianceDevice,
    capabilities: string,
    stateResponse?: string,
  ): Promise<void> {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(`${prefix}.raw.apiCapabilities`, capabilities);
    if (stateResponse !== undefined) {
      await this.setStateIfExists(
        `${prefix}.raw.apiLastStateResponse`,
        stateResponse,
      );
    }
  }

  /**
   * Update raw OpenAPI MQTT event data for a device.
   *
   * @param device Appliance device
   */
  async updateRawOpenapiData(device: ApplianceDevice): Promise<void> {
    const prefix = this.devicePrefix(device);
    await this.setStateIfExists(
      `${prefix}.raw.openapiLastEvents`,
      JSON.stringify(device.rawOpenapiEvents),
    );
    await this.setStateIfExists(
      `${prefix}.raw.openapiEventCount`,
      device.rawOpenapiEventCount,
    );
  }

  /**
   * Cleanup stale devices that no longer exist.
   *
   * @param currentDevices Current device list
   */
  async cleanupDevices(currentDevices: ApplianceDevice[]): Promise<void> {
    const currentPrefixes = new Set(
      currentDevices.map((d) => this.devicePrefix(d)),
    );

    const existingObjects = await this.adapter.getObjectViewAsync(
      "system",
      "device",
      {
        startkey: `${this.adapter.namespace}.devices.`,
        endkey: `${this.adapter.namespace}.devices.\u9999`,
      },
    );

    if (!existingObjects?.rows) {
      return;
    }

    for (const row of existingObjects.rows) {
      const localId = row.id.replace(`${this.adapter.namespace}.`, "");
      if (!currentPrefixes.has(localId)) {
        this.adapter.log.debug(`Removing stale device: ${localId}`);
        await this.adapter.delObjectAsync(localId, { recursive: true });
        for (const stateId of this.knownStates) {
          if (stateId.startsWith(`${localId}.`)) {
            this.knownStates.delete(stateId);
          }
        }
      }
    }
  }

  /**
   * Get device object ID prefix — stable SKU + short device ID.
   *
   * @param device Appliance device
   */
  devicePrefix(device: ApplianceDevice): string {
    return `devices.${buildDevicePrefix(device.sku, device.deviceId)}`;
  }

  /**
   * Remove stale states across all managed channels.
   *
   * @param prefix Device object ID prefix
   * @param stateDefs State definitions from capability mapper
   */
  private async cleanupAllChannelStates(
    prefix: string,
    stateDefs: StateDefinition[],
  ): Promise<void> {
    const expectedByChannel = new Map<string, Set<string>>();
    for (const def of stateDefs) {
      const channel = def.channel ?? "control";
      if (!expectedByChannel.has(channel)) {
        expectedByChannel.set(channel, new Set());
      }
      expectedByChannel.get(channel)!.add(def.id);
    }

    for (const channel of MANAGED_CHANNELS) {
      const channelPrefix = `${this.adapter.namespace}.${prefix}.${channel}.`;
      const existing = await this.adapter.getObjectViewAsync(
        "system",
        "state",
        {
          startkey: channelPrefix,
          endkey: `${channelPrefix}\u9999`,
        },
      );

      if (!existing?.rows) {
        continue;
      }

      const validIds = expectedByChannel.get(channel) ?? new Set<string>();
      let deleted = 0;
      for (const row of existing.rows) {
        const stateId = row.id.replace(channelPrefix, "");
        if (!validIds.has(stateId)) {
          const localId = row.id.replace(`${this.adapter.namespace}.`, "");
          this.adapter.log.debug(`Removing stale state: ${localId}`);
          await this.adapter.delObjectAsync(localId);
          await this.adapter.delStateAsync(localId).catch(() => {});
          this.knownStates.delete(localId);
          deleted++;
        }
      }

      // Remove empty channel object
      if (deleted > 0 && deleted === existing.rows.length) {
        this.adapter.log.debug(`Removing empty channel: ${prefix}.${channel}`);
        await this.adapter
          .delObjectAsync(`${prefix}.${channel}`)
          .catch(() => {});
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
  private async ensureState(
    id: string,
    name: string,
    type: ioBroker.CommonType,
    role: string,
    write: boolean,
  ): Promise<void> {
    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: { name, type, role, read: true, write } as ioBroker.StateCommon,
      native: {},
    });
    this.knownStates.add(id);
  }

  /**
   * Set state value only if the object exists.
   * Uses an in-memory cache populated during createDeviceStates to avoid
   * hitting the object DB on every update.
   *
   * @param id Identifier string
   * @param value Value to send
   */
  private async setStateIfExists(
    id: string,
    value: ioBroker.StateValue,
  ): Promise<void> {
    if (!this.knownStates.has(id)) {
      return;
    }
    await this.adapter.setStateAsync(id, { val: value, ack: true });
  }
}
