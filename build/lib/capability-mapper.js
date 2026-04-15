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
function mapCapabilities(capabilities) {
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
    case "dynamic_scene": {
      const id = sanitizeId(cap.instance);
      return [
        {
          id,
          name: humanize(cap.instance),
          type: "string",
          role: "json",
          write: true,
          def: "",
          capabilityType: cap.type,
          capabilityInstance: cap.instance
        }
      ];
    }
    default:
      return null;
  }
}
function mapRange(cap) {
  var _a, _b, _c;
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
      min: (_a = range == null ? void 0 : range.min) != null ? _a : 0,
      max: (_b = range == null ? void 0 : range.max) != null ? _b : 100,
      unit: (0, import_types.normalizeUnit)(cap.parameters.unit),
      def: (_c = range == null ? void 0 : range.min) != null ? _c : 0,
      capabilityType: cap.type,
      capabilityInstance: cap.instance
    }
  ];
}
function mapWorkMode(cap) {
  const fields = cap.parameters.fields;
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
  if (!cap.parameters.options || cap.parameters.options.length === 0) {
    return [];
  }
  const modeStates = {};
  for (const opt of cap.parameters.options) {
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
  var _a, _b;
  const fields = cap.parameters.fields;
  if (fields && fields.length > 0) {
    const tempField = fields.find(
      (f) => f.fieldName === "targetTemperature" || f.fieldName.toLowerCase().includes("temperature")
    );
    if (tempField == null ? void 0 : tempField.range) {
      const unit = (_a = (0, import_types.normalizeUnit)(cap.parameters.unit)) != null ? _a : "\xB0F";
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
  if (cap.parameters.range) {
    const unit = (_b = (0, import_types.normalizeUnit)(cap.parameters.unit)) != null ? _b : "\xB0F";
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
  var _a, _b, _c;
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
    const range = cap.parameters.range;
    return [
      {
        id: "color_temperature",
        name: "Color Temperature",
        type: "number",
        role: "level.color.temperature",
        write: true,
        min: (_a = range == null ? void 0 : range.min) != null ? _a : 2e3,
        max: (_b = range == null ? void 0 : range.max) != null ? _b : 9e3,
        unit: "K",
        def: (_c = range == null ? void 0 : range.min) != null ? _c : 2e3,
        capabilityType: cap.type,
        capabilityInstance: cap.instance
      }
    ];
  }
  return [];
}
function mapProperty(cap) {
  var _a;
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
      unit: (_a = (0, import_types.normalizeUnit)(cap.parameters.unit)) != null ? _a : unit,
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
  var _a;
  const shortType = cap.type.replace("devices.capabilities.", "");
  const raw = (_a = cap.state) == null ? void 0 : _a.value;
  if (raw === void 0 || raw === null) {
    return [];
  }
  switch (shortType) {
    case "on_off":
      return [{ stateId: "power", value: raw === 1 }];
    case "toggle":
      return [{ stateId: sanitizeId(cap.instance), value: raw === 1 }];
    case "range":
      return [{ stateId: sanitizeId(cap.instance), value: raw }];
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
            value: rgbIntToHex(num)
          }
        ];
      }
      if (cap.instance.includes("colorTem")) {
        return [{ stateId: "color_temperature", value: raw }];
      }
      return [];
    case "mode":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: typeof raw === "object" ? JSON.stringify(raw) : String(raw)
        }
      ];
    case "property":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: raw,
          channel: "sensor"
        }
      ];
    case "event":
      return [
        {
          stateId: sanitizeId(cap.instance),
          value: raw === 1 || raw === true,
          channel: "events"
        }
      ];
    case "online":
      return [{ stateId: "online", value: raw === true || raw === 1 }];
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
    results.push({
      stateId: "work_mode",
      value: struct.workMode
    });
  }
  if ("modeValue" in struct && struct.modeValue !== void 0) {
    results.push({
      stateId: "mode_value",
      value: struct.modeValue
    });
  }
  return results;
}
function mapTemperatureSettingState(raw) {
  var _a, _b;
  if (typeof raw === "number") {
    return [{ stateId: "target_temperature", value: raw }];
  }
  if (typeof raw === "object" && raw !== null) {
    const struct = raw;
    const temp = (_b = (_a = struct.targetTemperature) != null ? _a : struct.temperature) != null ? _b : struct.temp;
    if (typeof temp === "number") {
      return [{ stateId: "target_temperature", value: temp }];
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
