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
var govee_app_api_client_exports = {};
__export(govee_app_api_client_exports, {
  GoveeAppApiClient: () => GoveeAppApiClient,
  parseLastData: () => parseLastData,
  parseSettings: () => parseSettings
});
module.exports = __toCommonJS(govee_app_api_client_exports);
var import_http_client = require("./http-client.js");
var import_govee_constants = require("./govee-constants.js");
class GoveeAppApiClient {
  bearerToken = null;
  /**
   * Update the bearer token (obtained from MQTT login).
   *
   * @param token Fresh bearer token from Govee login
   */
  setBearerToken(token) {
    this.bearerToken = token;
  }
  /** Whether a token is available. */
  hasBearerToken() {
    return !!this.bearerToken;
  }
  authHeaders() {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      appVersion: import_govee_constants.GOVEE_APP_VERSION,
      clientId: import_govee_constants.GOVEE_CLIENT_ID,
      clientType: import_govee_constants.GOVEE_CLIENT_TYPE,
      "User-Agent": import_govee_constants.GOVEE_USER_AGENT
    };
  }
  /**
   * Fetch the full device list from the app API. One call returns every
   * device on the account with `lastDeviceData` + `deviceSettings` embedded
   * as stringified JSON — cheap and safe to poll on a conservative schedule.
   *
   * The endpoint is `POST /device/rest/devices/v1/list` with an empty body;
   * the bearer token is the only auth.
   *
   * @returns Parsed entries; never throws on a single malformed entry.
   */
  async fetchDeviceList() {
    if (!this.bearerToken) {
      return [];
    }
    const resp = await (0, import_http_client.httpsRequest)({
      method: "POST",
      url: `${import_govee_constants.GOVEE_APP_BASE_URL}/device/rest/devices/v1/list`,
      headers: this.authHeaders(),
      body: {}
    });
    const out = [];
    const list = Array.isArray(resp == null ? void 0 : resp.devices) ? resp.devices : [];
    for (const d of list) {
      if (!d || typeof d.sku !== "string" || typeof d.device !== "string") {
        continue;
      }
      const entry = {
        sku: d.sku,
        device: d.device,
        deviceName: typeof d.deviceName === "string" ? d.deviceName : d.sku,
        deviceId: typeof d.deviceId === "number" ? d.deviceId : void 0,
        versionHard: typeof d.versionHard === "string" ? d.versionHard : void 0,
        versionSoft: typeof d.versionSoft === "string" ? d.versionSoft : void 0
      };
      const ext = d.deviceExt;
      if (ext && typeof ext === "object") {
        entry.lastData = parseLastData(ext.lastDeviceData);
        entry.settings = parseSettings(ext.deviceSettings);
      }
      out.push(entry);
    }
    return out;
  }
}
function parseLastData(raw) {
  if (typeof raw !== "string" || !raw) {
    return void 0;
  }
  try {
    const obj = JSON.parse(raw);
    const out = {};
    if (typeof obj.online === "boolean") {
      out.online = obj.online;
    } else if (obj.online === 1 || obj.online === 0) {
      out.online = obj.online === 1;
    }
    if (typeof obj.tem === "number" && Number.isFinite(obj.tem)) {
      out.tem = obj.tem;
    }
    if (typeof obj.hum === "number" && Number.isFinite(obj.hum)) {
      out.hum = obj.hum;
    }
    if (typeof obj.battery === "number" && Number.isFinite(obj.battery)) {
      out.battery = obj.battery;
    }
    if (typeof obj.lastTime === "number" && Number.isFinite(obj.lastTime)) {
      out.lastTime = obj.lastTime;
    }
    return out;
  } catch {
    return void 0;
  }
}
function parseSettings(raw) {
  if (typeof raw !== "string" || !raw) {
    return void 0;
  }
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : void 0;
  } catch {
    return void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GoveeAppApiClient,
  parseLastData,
  parseSettings
});
//# sourceMappingURL=govee-app-api-client.js.map
