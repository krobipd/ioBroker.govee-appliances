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
var types_exports = {};
__export(types_exports, {
  LIGHT_TYPES: () => LIGHT_TYPES,
  classifyError: () => classifyError,
  devicePrefix: () => devicePrefix,
  normalizeDeviceId: () => normalizeDeviceId,
  normalizeUnit: () => normalizeUnit,
  shortDeviceId: () => shortDeviceId
});
module.exports = __toCommonJS(types_exports);
const LIGHT_TYPES = ["devices.types.light"];
function normalizeDeviceId(id) {
  if (typeof id !== "string") {
    return "";
  }
  return id.replace(/:/g, "").toLowerCase();
}
function classifyError(err) {
  if (err instanceof Error) {
    const code = err.code;
    if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENOTFOUND" || code === "ENETUNREACH" || code === "ECONNRESET" || code === "EAI_AGAIN") {
      return "NETWORK";
    }
    if (code === "ETIMEDOUT" || err.message.includes("timed out")) {
      return "TIMEOUT";
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ENETUNREACH") || msg.includes("ECONNRESET")) {
    return "NETWORK";
  }
  if (msg.includes("Timeout")) {
    return "TIMEOUT";
  }
  if (msg.includes("429") || msg.includes("Rate limit") || msg.includes("Rate limited")) {
    return "RATE_LIMIT";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("Login failed") || msg.includes("auth")) {
    return "AUTH";
  }
  return "UNKNOWN";
}
function shortDeviceId(deviceId) {
  const normalized = normalizeDeviceId(deviceId);
  return normalized.slice(-4);
}
function devicePrefix(sku, deviceId) {
  return `${sku.toLowerCase()}_${shortDeviceId(deviceId)}`;
}
function normalizeUnit(unit) {
  var _a;
  if (!unit) {
    return void 0;
  }
  const map = {
    "unit.percent": "%",
    "unit.kelvin": "K",
    "unit.celsius": "\xB0C",
    "unit.fahrenheit": "\xB0F"
  };
  return (_a = map[unit]) != null ? _a : unit;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LIGHT_TYPES,
  classifyError,
  devicePrefix,
  normalizeDeviceId,
  normalizeUnit,
  shortDeviceId
});
//# sourceMappingURL=types.js.map
