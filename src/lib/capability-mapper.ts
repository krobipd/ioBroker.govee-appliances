import type {
  CloudCapability,
  CloudStateCapability,
  ApplianceDevice,
} from "./types.js";
import { normalizeUnit } from "./types.js";

/** ioBroker state definition derived from a Govee capability */
export interface StateDefinition {
  /** State ID suffix (e.g. "power", "brightness", "work_mode") */
  id: string;
  /** Display name */
  name: string;
  /** ioBroker value type */
  type: ioBroker.CommonType;
  /** ioBroker role */
  role: string;
  /** Whether state is writable */
  write: boolean;
  /** Unit string */
  unit?: string;
  /** Min value for numbers */
  min?: number;
  /** Max value for numbers */
  max?: number;
  /** Predefined states for select (value → label) */
  states?: Record<string, string>;
  /** Default value for new states */
  def?: ioBroker.StateValue;
  /** Original capability type */
  capabilityType: string;
  /** Original capability instance */
  capabilityInstance: string;
  /** Target channel (control, sensor, events). Defaults to "control". */
  channel?: string;
}

/**
 * Maps Govee Cloud API capabilities to ioBroker state definitions.
 * Pure function — no side effects, easily testable.
 *
 * @param capabilities Device capabilities from Cloud API
 */
export function mapCapabilities(
  capabilities: CloudCapability[],
): StateDefinition[] {
  const states: StateDefinition[] = [];

  for (const cap of capabilities) {
    const mapped = mapSingleCapability(cap);
    if (mapped) {
      states.push(...mapped);
    }
  }

  return states;
}

/**
 * Build complete state definitions for an appliance device.
 * Adds raw-data and diagnostics states on top of capability-derived states.
 *
 * @param device Appliance device
 */
export function buildDeviceStateDefs(
  device: ApplianceDevice,
): StateDefinition[] {
  const stateDefs = mapCapabilities(device.capabilities);

  // Diagnostics export button + result (under raw channel)
  stateDefs.push({
    id: "diagnostics_export",
    name: "Export Diagnostics",
    type: "boolean",
    role: "button",
    write: true,
    def: false,
    capabilityType: "local",
    capabilityInstance: "diagnosticsExport",
    channel: "raw",
  });
  stateDefs.push({
    id: "diagnostics_result",
    name: "Diagnostics JSON",
    type: "string",
    role: "json",
    write: false,
    def: "",
    capabilityType: "local",
    capabilityInstance: "diagnosticsResult",
    channel: "raw",
  });

  // Raw MQTT packet log
  stateDefs.push({
    id: "mqttLastPackets",
    name: "Last MQTT BLE Packets",
    type: "string",
    role: "json",
    write: false,
    def: "[]",
    capabilityType: "local",
    capabilityInstance: "mqttLastPackets",
    channel: "raw",
  });
  stateDefs.push({
    id: "mqttPacketCount",
    name: "MQTT Packet Count",
    type: "number",
    role: "value",
    write: false,
    def: 0,
    capabilityType: "local",
    capabilityInstance: "mqttPacketCount",
    channel: "raw",
  });

  // Full capability dump from API
  stateDefs.push({
    id: "apiCapabilities",
    name: "API Capabilities",
    type: "string",
    role: "json",
    write: false,
    def: "",
    capabilityType: "local",
    capabilityInstance: "apiCapabilities",
    channel: "raw",
  });

  // Last state response from API
  stateDefs.push({
    id: "apiLastStateResponse",
    name: "Last API State Response",
    type: "string",
    role: "json",
    write: false,
    def: "",
    capabilityType: "local",
    capabilityInstance: "apiLastStateResponse",
    channel: "raw",
  });

  // OpenAPI MQTT event log
  stateDefs.push({
    id: "openapiLastEvents",
    name: "Last OpenAPI MQTT Events",
    type: "string",
    role: "json",
    write: false,
    def: "[]",
    capabilityType: "local",
    capabilityInstance: "openapiLastEvents",
    channel: "raw",
  });
  stateDefs.push({
    id: "openapiEventCount",
    name: "OpenAPI MQTT Event Count",
    type: "number",
    role: "value",
    write: false,
    def: 0,
    capabilityType: "local",
    capabilityInstance: "openapiEventCount",
    channel: "raw",
  });

  return stateDefs;
}

/**
 * Map a single capability to state definition(s)
 *
 * @param cap Cloud capability to map
 */
function mapSingleCapability(cap: CloudCapability): StateDefinition[] | null {
  const shortType = cap.type.replace("devices.capabilities.", "");

  switch (shortType) {
    case "on_off":
      return [
        {
          id: "power",
          name: "Power",
          type: "boolean",
          role: "switch",
          write: true,
          def: false,
          capabilityType: cap.type,
          capabilityInstance: cap.instance,
        },
      ];

    case "toggle":
      return [
        {
          id: sanitizeId(cap.instance),
          name: humanize(cap.instance),
          type: "boolean",
          role: "switch",
          write: true,
          def: false,
          capabilityType: cap.type,
          capabilityInstance: cap.instance,
        },
      ];

    case "range":
      return mapRange(cap);

    case "work_mode":
      return mapWorkMode(cap);

    case "mode":
      return mapMode(cap);

    case "temperature_setting":
      return mapTemperatureSetting(cap);

    case "color_setting":
      return mapColorSetting(cap);

    case "property":
      return mapProperty(cap);

    case "event":
      return mapEvent(cap);

    case "online":
      return null;

    default:
      return null;
  }
}

/**
 * Map range capability (brightness, humidity target, timer, etc.)
 *
 * @param cap Cloud capability to map
 */
function mapRange(cap: CloudCapability): StateDefinition[] {
  const range = cap.parameters.range;
  const inst = cap.instance.toLowerCase();
  let role = "level";

  if (inst.includes("brightness")) {
    role = "level.brightness";
  } else if (inst.includes("humidity")) {
    role = "level";
  }

  return [
    {
      id: sanitizeId(cap.instance),
      name: humanize(cap.instance),
      type: "number",
      role,
      write: true,
      min: range?.min ?? 0,
      max: range?.max ?? 100,
      unit: normalizeUnit(cap.parameters.unit),
      def: range?.min ?? 0,
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
    },
  ];
}

/**
 * Map work_mode capability (STRUCT with workMode + optional modeValue).
 * Creates a dropdown for mode selection.
 *
 * @param cap Cloud capability to map
 */
function mapWorkMode(cap: CloudCapability): StateDefinition[] {
  const fields = cap.parameters.fields;
  if (!fields || fields.length === 0) {
    // Fallback: expose as JSON
    return [
      {
        id: "work_mode",
        name: "Work Mode",
        type: "string",
        role: "json",
        write: true,
        def: "",
        capabilityType: cap.type,
        capabilityInstance: cap.instance,
      },
    ];
  }

  const states: StateDefinition[] = [];

  // Main work mode dropdown
  const modeField = fields.find((f) => f.fieldName === "workMode");
  if (modeField?.options && modeField.options.length > 0) {
    const modeStates: Record<string, string> = {};
    for (const opt of modeField.options) {
      modeStates[String(opt.value as string | number)] = opt.name;
    }
    states.push({
      id: "work_mode",
      name: "Work Mode",
      type: "number",
      role: "level.mode",
      write: true,
      states: modeStates,
      def: modeField.options[0] ? (modeField.options[0].value as number) : 0,
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
    });
  }

  // Mode value (secondary parameter per mode, e.g. fan speed level within a mode)
  const valueField = fields.find((f) => f.fieldName === "modeValue");
  if (valueField) {
    if (valueField.options && valueField.options.length > 0) {
      const valStates: Record<string, string> = {};
      for (const opt of valueField.options) {
        valStates[String(opt.value as string | number)] = opt.name;
      }
      states.push({
        id: "mode_value",
        name: "Mode Value",
        type: "number",
        role: "level",
        write: true,
        states: valStates,
        def: valueField.options[0]
          ? (valueField.options[0].value as number)
          : 0,
        capabilityType: cap.type,
        capabilityInstance: cap.instance,
      });
    } else if (valueField.range) {
      states.push({
        id: "mode_value",
        name: "Mode Value",
        type: "number",
        role: "level",
        write: true,
        min: valueField.range.min,
        max: valueField.range.max,
        def: valueField.range.min,
        capabilityType: cap.type,
        capabilityInstance: cap.instance,
      });
    }
  }

  return states;
}

/**
 * Map mode capability (preset scenes/modes with ENUM options)
 *
 * @param cap Cloud capability to map
 */
function mapMode(cap: CloudCapability): StateDefinition[] {
  if (!cap.parameters.options || cap.parameters.options.length === 0) {
    return [];
  }

  const modeStates: Record<string, string> = {};
  for (const opt of cap.parameters.options) {
    const val =
      typeof opt.value === "object"
        ? JSON.stringify(opt.value)
        : String(opt.value);
    modeStates[val] = opt.name;
  }

  return [
    {
      id: sanitizeId(cap.instance),
      name: humanize(cap.instance),
      type: "string",
      role: "text",
      write: true,
      states: modeStates,
      def: "",
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
    },
  ];
}

/**
 * Map temperature_setting capability (STRUCT with target temperature)
 *
 * @param cap Cloud capability to map
 */
function mapTemperatureSetting(cap: CloudCapability): StateDefinition[] {
  // Try to find targetTemperature field in STRUCT
  const fields = cap.parameters.fields;
  if (fields && fields.length > 0) {
    const tempField = fields.find(
      (f) =>
        f.fieldName === "targetTemperature" ||
        f.fieldName.toLowerCase().includes("temperature"),
    );
    if (tempField?.range) {
      const unit = normalizeUnit(cap.parameters.unit) ?? "°F";
      return [
        {
          id: "target_temperature",
          name: "Target Temperature",
          type: "number",
          role: "level.temperature",
          write: true,
          min: tempField.range.min,
          max: tempField.range.max,
          unit,
          def: tempField.range.min,
          capabilityType: cap.type,
          capabilityInstance: cap.instance,
        },
      ];
    }
  }

  // Simple range-based temperature
  if (cap.parameters.range) {
    const unit = normalizeUnit(cap.parameters.unit) ?? "°F";
    return [
      {
        id: "target_temperature",
        name: "Target Temperature",
        type: "number",
        role: "level.temperature",
        write: true,
        min: cap.parameters.range.min,
        max: cap.parameters.range.max,
        unit,
        def: cap.parameters.range.min,
        capabilityType: cap.type,
        capabilityInstance: cap.instance,
      },
    ];
  }

  // Fallback: expose as JSON
  return [
    {
      id: "target_temperature",
      name: "Target Temperature",
      type: "string",
      role: "json",
      write: true,
      def: "",
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
    },
  ];
}

/**
 * Map color_setting capability (nightlight color on humidifiers etc.)
 *
 * @param cap Cloud capability to map
 */
function mapColorSetting(cap: CloudCapability): StateDefinition[] {
  if (cap.instance === "colorRgb") {
    return [
      {
        id: "color_rgb",
        name: "Color RGB",
        type: "string",
        role: "level.color.rgb",
        write: true,
        def: "#000000",
        capabilityType: cap.type,
        capabilityInstance: cap.instance,
      },
    ];
  }

  if (
    cap.instance === "colorTemperatureK" ||
    cap.instance.includes("colorTem")
  ) {
    const range = cap.parameters.range;
    return [
      {
        id: "color_temperature",
        name: "Color Temperature",
        type: "number",
        role: "level.color.temperature",
        write: true,
        min: range?.min ?? 2000,
        max: range?.max ?? 9000,
        unit: "K",
        def: range?.min ?? 2000,
        capabilityType: cap.type,
        capabilityInstance: cap.instance,
      },
    ];
  }

  return [];
}

/**
 * Map property capability (read-only sensor values)
 *
 * @param cap Cloud capability to map
 */
function mapProperty(cap: CloudCapability): StateDefinition[] {
  const instance = cap.instance.toLowerCase();
  let role = "value";
  let unit: string | undefined;

  if (instance.includes("temperature")) {
    role = "value.temperature";
    unit = "°C";
  } else if (instance.includes("humidity")) {
    role = "value.humidity";
    unit = "%";
  } else if (instance.includes("battery")) {
    role = "value.battery";
    unit = "%";
  } else if (instance.includes("co2") || instance.includes("carbondioxide")) {
    role = "value.co2";
    unit = "ppm";
  }

  return [
    {
      id: sanitizeId(cap.instance),
      name: humanize(cap.instance),
      type: "number",
      role,
      write: false,
      unit: normalizeUnit(cap.parameters.unit) ?? unit,
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
      channel: "sensor",
    },
  ];
}

/**
 * Map event capability (async MQTT alarms — read-only)
 *
 * @param cap Cloud capability to map
 */
function mapEvent(cap: CloudCapability): StateDefinition[] {
  // Events are boolean indicators (active/inactive)
  return [
    {
      id: sanitizeId(cap.instance),
      name: humanize(cap.instance),
      type: "boolean",
      role: "indicator.alarm",
      write: false,
      def: false,
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
      channel: "events",
    },
  ];
}

/** Mapped Cloud state value: state ID + converted value + channel */
export interface CloudStateValue {
  /** State ID (e.g. "power", "work_mode", "sensor_temperature") */
  stateId: string;
  /** Converted value ready for ioBroker setStateAsync */
  value: ioBroker.StateValue;
  /** Target channel */
  channel?: string;
}

/**
 * Map a Cloud device state capability to a state ID + converted value.
 * Uses the same ID logic as mapCapabilities so IDs always match.
 *
 * @param cap Cloud capability to map
 */
export function mapCloudStateValue(
  cap: CloudStateCapability,
): CloudStateValue[] {
  const shortType = cap.type.replace("devices.capabilities.", "");
  const raw = cap.state?.value;
  if (raw === undefined || raw === null) {
    return [];
  }

  switch (shortType) {
    case "on_off":
      return [{ stateId: "power", value: raw === 1 || raw === true }];

    case "toggle":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: raw === 1 || raw === true,
        },
      ];

    case "range":
      return [{ stateId: sanitizeId(cap.instance), value: raw as number }];

    case "work_mode":
      return mapWorkModeState(raw);

    case "temperature_setting":
      return mapTemperatureSettingState(raw);

    case "color_setting":
      if (cap.instance === "colorRgb") {
        const num = typeof raw === "number" ? raw : 0;
        return [
          {
            stateId: "color_rgb",
            value: rgbIntToHex(num),
          },
        ];
      }
      if (cap.instance.includes("colorTem")) {
        return [{ stateId: "color_temperature", value: raw as number }];
      }
      return [];

    case "mode":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value:
            typeof raw === "object"
              ? JSON.stringify(raw)
              : String(raw as string | number | boolean),
        },
      ];

    case "property":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: raw as number,
          channel: "sensor",
        },
      ];

    case "event":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: raw === 1 || raw === true,
          channel: "events",
        },
      ];

    case "online":
      return [{ stateId: "online", value: raw === true || raw === 1 }];

    default:
      return [];
  }
}

/**
 * Extract work_mode state values from STRUCT response.
 * Returns separate values for work_mode and mode_value.
 *
 * @param raw Raw state value
 */
function mapWorkModeState(raw: unknown): CloudStateValue[] {
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const struct = raw as Record<string, unknown>;
  const results: CloudStateValue[] = [];

  if ("workMode" in struct && struct.workMode !== undefined) {
    results.push({
      stateId: "work_mode",
      value: struct.workMode as number,
    });
  }
  if ("modeValue" in struct && struct.modeValue !== undefined) {
    results.push({
      stateId: "mode_value",
      value: struct.modeValue as number,
    });
  }

  return results;
}

/**
 * Extract temperature_setting state value.
 *
 * @param raw Raw state value
 */
function mapTemperatureSettingState(raw: unknown): CloudStateValue[] {
  if (typeof raw === "number") {
    return [{ stateId: "target_temperature", value: raw }];
  }
  if (typeof raw === "object" && raw !== null) {
    const struct = raw as Record<string, unknown>;
    const temp = struct.targetTemperature ?? struct.temperature ?? struct.temp;
    if (typeof temp === "number") {
      return [{ stateId: "target_temperature", value: temp }];
    }
  }
  return [];
}

/**
 * Convert RGB integer (0xRRGGBB) to hex string (#RRGGBB)
 *
 * @param num RGB integer value
 */
function rgbIntToHex(num: number): string {
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Sanitize a string for use as ioBroker state ID
 *
 * @param str Input string
 */
function sanitizeId(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase();
}

/**
 * Convert camelCase to human-readable name
 *
 * @param str Input string
 */
function humanize(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}
