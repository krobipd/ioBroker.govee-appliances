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
var govee_cloud_client_exports = {};
__export(govee_cloud_client_exports, {
  GoveeCloudClient: () => GoveeCloudClient
});
module.exports = __toCommonJS(govee_cloud_client_exports);
var import_http_client = require("./http-client.js");
const BASE_URL = "https://openapi.api.govee.com";
class GoveeCloudClient {
  apiKey;
  log;
  /**
   * @param apiKey Govee API key
   * @param log ioBroker logger
   */
  constructor(apiKey, log) {
    this.apiKey = apiKey;
    this.log = log;
  }
  /** Fetch all devices with their capabilities */
  async getDevices() {
    var _a;
    const resp = await this.request(
      "GET",
      "/router/api/v1/user/devices"
    );
    return (_a = resp.data) != null ? _a : [];
  }
  /**
   * Fetch current state of a device
   *
   * @param sku Product model
   * @param device Device identifier
   */
  async getDeviceState(sku, device) {
    var _a, _b;
    const resp = await this.request(
      "POST",
      "/router/api/v1/device/state",
      {
        requestId: `state_${Date.now()}`,
        payload: { sku, device }
      }
    );
    return (_b = (_a = resp.data) == null ? void 0 : _a.capabilities) != null ? _b : [];
  }
  /**
   * Send a control command to a device
   *
   * @param sku Product model
   * @param device Device ID
   * @param capabilityType Full capability type string
   * @param instance Capability instance name
   * @param value Value to set
   */
  async controlDevice(sku, device, capabilityType, instance, value) {
    await this.request("POST", "/router/api/v1/device/control", {
      requestId: `ctrl_${Date.now()}`,
      payload: {
        sku,
        device,
        capability: {
          type: capabilityType,
          instance,
          value
        }
      }
    });
  }
  /**
   * Make an HTTPS request to the Govee Cloud API
   *
   * @param method HTTP method (GET, POST)
   * @param path API endpoint path
   * @param body Optional request body
   */
  async request(method, path, body) {
    var _a;
    this.log.debug(`Cloud API: ${method} ${path}`);
    try {
      return await (0, import_http_client.httpsRequest)({
        method,
        url: new URL(path, BASE_URL).toString(),
        headers: { "Govee-API-Key": this.apiKey },
        body
      });
    } catch (err) {
      if (err instanceof import_http_client.HttpError && err.statusCode === 429) {
        const retryAfter = String((_a = err.headers["retry-after"]) != null ? _a : "unknown");
        throw new import_http_client.HttpError(
          `Rate limited \u2014 retry after ${retryAfter}s`,
          429,
          err.headers
        );
      }
      throw err;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GoveeCloudClient
});
//# sourceMappingURL=govee-cloud-client.js.map
