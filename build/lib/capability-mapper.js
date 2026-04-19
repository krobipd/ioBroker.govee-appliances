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
var capability_mapper_exports = {};
__export(capability_mapper_exports, {
  buildDeviceStateDefs: () => buildDeviceStateDefs,
  mapCapabilities: () => mapCapabilities,
  mapCloudStateValue: () => mapCloudStateValue
});
module.exports = __toCommonJS(capability_mapper_exports);
var import_types = require("./types.js");
function coerceBool(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}
function coerceNum(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}
function mapCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) {
    return [];
  }
  const states = [];
  for (const cap of capabilities) {
    const mapped = mapSingleCapability(cap);
    if (mapped) {
      states.push(...mapped);
    }
  }
  return states;
}
function buildDeviceStateDefs(device) {
  const stateDefs = mapCapabilities(device.capabilities);
  stateDefs.push({
    id: "diagnostics_export",
    name: "Export Diagnostics",
    type: "boolean",
    role: "button",
    write: true,
    def: false,
    capabilityType: "local",
    capabilityInstance: "diagnosticsExport",
    channel: "raw"
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
    channel: "raw"
  });
  stateDefs.push({
    id: "mqttLastPackets",
    name: "Last MQTT BLE Packets",
    type: "string",
    role: "json",
    write: false,
    def: "[]",
    capabilityType: "local",
    capabilityInstance: "mqttLastPackets",
    channel: "raw"
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
    channel: "raw"
  });
  stateDefs.push({
    id: "apiCapabilities",
    name: "API Capabilities",
    type: "string",
    role: "json",
    write: false,
    def: "",
    capabilityType: "local",
    capabilityInstance: "apiCapabilities",
    channel: "raw"
  });
  stateDefs.push({
    id: "apiLastStateResponse",
    name: "Last API State Response",
    type: "string",
    role: "json",
    write: false,
    def: "",
    capabilityType: "local",
    capabilityInstance: "apiLastStateResponse",
    channel: "raw"
  });
  stateDefs.push({
    id: "openapiLastEvents",
    name: "Last OpenAPI MQTT Events",
    type: "string",
    role: "json",
    write: false,
    def: "[]",
    capabilityType: "local",
    capabilityInstance: "openapiLastEvents",
    channel: "raw"
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
    channel: "raw"
  });
  return stateDefs;
}
function mapSingleCapability(cap) {
  if (typeof (cap == null ? void 0 : cap.type) !== "string" || typeof cap.instance !== "string") {
    return null;
  }
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
          capabilityInstance: cap.instance
        }
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
          capabilityInstance: cap.instance
        }
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
function mapRange(cap) {
  var _a, _b, _c, _d, _e;
  const range = (_a = cap.parameters) == null ? void 0 : _a.range;
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
      min: (_b = range == null ? void 0 : range.min) != null ? _b : 0,
      max: (_c = range == null ? void 0 : range.max) != null ? _c : 100,
      unit: (0, import_types.normalizeUnit)((_d = cap.parameters) == null ? void 0 : _d.unit),
      def: (_e = range == null ? void 0 : range.min) != null ? _e : 0,
      capabilityType: cap.type,
      capabilityInstance: cap.instance
    }
  ];
}
function mapWorkMode(cap) {
  var _a;
  const fields = (_a = cap.parameters) == null ? void 0 : _a.fields;
  if (!fields || fields.length === 0) {
    return [
      {
        id: "work_mode",
        name: "Work Mode",
        type: "string",
        role: "json",
        write: true,
        def: "",
        capabilityType: cap.type,
        capabilityInstance: cap.instance
      }
    ];
  }
  const states = [];
  const modeField = fields.find((f) => f.fieldName === "workMode");
  if ((modeField == null ? void 0 : modeField.options) && modeField.options.length > 0) {
    const modeStates = {};
    for (const opt of modeField.options) {
      modeStates[String(opt.value)] = opt.name;
    }
    states.push({
      id: "work_mode",
      name: "Work Mode",
      type: "number",
      role: "level.mode",
      write: true,
      states: modeStates,
      def: modeField.options[0] ? modeField.options[0].value : 0,
      capabilityType: cap.type,
      capabilityInstance: cap.instance
    });
  }
  const valueField = fields.find((f) => f.fieldName === "modeValue");
  if (valueField) {
    if (valueField.options && valueField.options.length > 0) {
      const valStates = {};
      for (const opt of valueField.options) {
        valStates[String(opt.value)] = opt.name;
      }
      states.push({
        id: "mode_value",
        name: "Mode Value",
        type: "number",
        role: "level",
        write: true,
        states: valStates,
        def: valueField.options[0] ? valueField.options[0].value : 0,
        capabilityType: cap.type,
        capabilityInstance: cap.instance
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
        capabilityInstance: cap.instance
      });
    }
  }
  return states;
}
function mapMode(cap) {
  var _a;
  const options = (_a = cap.parameters) == null ? void 0 : _a.options;
  if (!options || options.length === 0) {
    return [];
  }
  const modeStates = {};
  for (const opt of options) {
    const val = typeof opt.value === "object" ? JSON.stringify(opt.value) : String(opt.value);
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
      capabilityInstance: cap.instance
    }
  ];
}
function mapTemperatureSetting(cap) {
  var _a, _b, _c, _d, _e, _f;
  const fields = (_a = cap.parameters) == null ? void 0 : _a.fields;
  if (fields && fields.length > 0) {
    const tempField = fields.find((f) => {
      if (f.fieldName === "targetTemperature") {
        return true;
      }
      if (typeof f.fieldName !== "string") {
        return false;
      }
      return f.fieldName.toLowerCase().includes("temperature");
    });
    if (tempField == null ? void 0 : tempField.range) {
      const unit = (_c = (0, import_types.normalizeUnit)((_b = cap.parameters) == null ? void 0 : _b.unit)) != null ? _c : "\xB0F";
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
          capabilityInstance: cap.instance
        }
      ];
    }
  }
  const range = (_d = cap.parameters) == null ? void 0 : _d.range;
  if (range) {
    const unit = (_f = (0, import_types.normalizeUnit)((_e = cap.parameters) == null ? void 0 : _e.unit)) != null ? _f : "\xB0F";
    return [
      {
        id: "target_temperature",
        name: "Target Temperature",
        type: "number",
        role: "level.temperature",
        write: true,
        min: range.min,
        max: range.max,
        unit,
        def: range.min,
        capabilityType: cap.type,
        capabilityInstance: cap.instance
      }
    ];
  }
  return [
    {
      id: "target_temperature",
      name: "Target Temperature",
      type: "string",
      role: "json",
      write: true,
      def: "",
      capabilityType: cap.type,
      capabilityInstance: cap.instance
    }
  ];
}
function mapColorSetting(cap) {
  var _a, _b, _c, _d;
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
        capabilityInstance: cap.instance
      }
    ];
  }
  if (cap.instance === "colorTemperatureK" || cap.instance.includes("colorTem")) {
    const range = (_a = cap.parameters) == null ? void 0 : _a.range;
    return [
      {
        id: "color_temperature",
        name: "Color Temperature",
        type: "number",
        role: "level.color.temperature",
        write: true,
        min: (_b = range == null ? void 0 : range.min) != null ? _b : 2e3,
        max: (_c = range == null ? void 0 : range.max) != null ? _c : 9e3,
        unit: "K",
        def: (_d = range == null ? void 0 : range.min) != null ? _d : 2e3,
        capabilityType: cap.type,
        capabilityInstance: cap.instance
      }
    ];
  }
  return [];
}
function mapProperty(cap) {
  var _a, _b;
  const instance = cap.instance.toLowerCase();
  let role = "value";
  let unit;
  if (instance.includes("temperature")) {
    role = "value.temperature";
    unit = "\xB0C";
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
      unit: (_b = (0, import_types.normalizeUnit)((_a = cap.parameters) == null ? void 0 : _a.unit)) != null ? _b : unit,
      capabilityType: cap.type,
      capabilityInstance: cap.instance,
      channel: "sensor"
    }
  ];
}
function mapEvent(cap) {
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
      channel: "events"
    }
  ];
}
function mapCloudStateValue(cap) {
  var _a, _b;
  if (typeof (cap == null ? void 0 : cap.type) !== "string" || typeof cap.instance !== "string") {
    return [];
  }
  const shortType = cap.type.replace("devices.capabilities.", "");
  const raw = (_a = cap.state) == null ? void 0 : _a.value;
  if (raw === void 0 || raw === null) {
    return [];
  }
  switch (shortType) {
    case "on_off":
      return [{ stateId: "power", value: coerceBool(raw) }];
    case "toggle":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: coerceBool(raw)
        }
      ];
    case "range": {
      const num = coerceNum(raw);
      if (num === null) {
        return [];
      }
      return [{ stateId: sanitizeId(cap.instance), value: num }];
    }
    case "work_mode":
      return mapWorkModeState(raw);
    case "temperature_setting":
      return mapTemperatureSettingState(raw);
    case "color_setting":
      if (cap.instance === "colorRgb") {
        const num = (_b = coerceNum(raw)) != null ? _b : 0;
        return [
          {
            stateId: "color_rgb",
            value: rgbIntToHex(num)
          }
        ];
      }
      if (cap.instance.includes("colorTem")) {
        const num = coerceNum(raw);
        if (num === null) {
          return [];
        }
        return [{ stateId: "color_temperature", value: num }];
      }
      return [];
    case "mode":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: typeof raw === "object" ? JSON.stringify(raw) : String(raw)
        }
      ];
    case "property": {
      const num = coerceNum(raw);
      if (num === null) {
        return [];
      }
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: num,
          channel: "sensor"
        }
      ];
    }
    case "event":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: coerceBool(raw),
          channel: "events"
        }
      ];
    case "online":
      return [{ stateId: "online", value: coerceBool(raw) }];
    default:
      return [];
  }
}
function mapWorkModeState(raw) {
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const struct = raw;
  const results = [];
  if ("workMode" in struct && struct.workMode !== void 0) {
    const n = coerceNum(struct.workMode);
    if (n !== null) {
      results.push({ stateId: "work_mode", value: n });
    }
  }
  if ("modeValue" in struct && struct.modeValue !== void 0) {
    const n = coerceNum(struct.modeValue);
    if (n !== null) {
      results.push({ stateId: "mode_value", value: n });
    }
  }
  return results;
}
function mapTemperatureSettingState(raw) {
  var _a, _b;
  const direct = coerceNum(raw);
  if (direct !== null) {
    return [{ stateId: "target_temperature", value: direct }];
  }
  if (typeof raw === "object" && raw !== null) {
    const struct = raw;
    const temp = (_b = (_a = struct.targetTemperature) != null ? _a : struct.temperature) != null ? _b : struct.temp;
    const n = coerceNum(temp);
    if (n !== null) {
      return [{ stateId: "target_temperature", value: n }];
    }
  }
  return [];
}
function rgbIntToHex(num) {
  const r = num >> 16 & 255;
  const g = num >> 8 & 255;
  const b = num & 255;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function sanitizeId(str) {
  return str.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}
function humanize(str) {
  return str.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildDeviceStateDefs,
  mapCapabilities,
  mapCloudStateValue
});
//# sourceMappingURL=capability-mapper.js.map
