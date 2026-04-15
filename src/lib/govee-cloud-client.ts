import { httpsRequest, HttpError } from "./http-client.js";
import type {
  CloudDevice,
  CloudDeviceListResponse,
  CloudDeviceStateResponse,
  CloudStateCapability,
} from "./types.js";

const BASE_URL = "https://openapi.api.govee.com";

/**
 * Govee Cloud API v2 client for appliances.
 * Used for device list, capabilities, state polling, and control.
 */
export class GoveeCloudClient {
  private readonly apiKey: string;
  private readonly log: ioBroker.Logger;

  /**
   * @param apiKey Govee API key
   * @param log ioBroker logger
   */
  constructor(apiKey: string, log: ioBroker.Logger) {
    this.apiKey = apiKey;
    this.log = log;
  }

  /** Fetch all devices with their capabilities */
  async getDevices(): Promise<CloudDevice[]> {
    const resp = await this.request<CloudDeviceListResponse>(
      "GET",
      "/router/api/v1/user/devices",
    );
    return resp.data ?? [];
  }

  /**
   * Fetch current state of a device
   *
   * @param sku Product model
   * @param device Device identifier
   */
  async getDeviceState(
    sku: string,
    device: string,
  ): Promise<CloudStateCapability[]> {
    const resp = await this.request<CloudDeviceStateResponse>(
      "POST",
      "/router/api/v1/device/state",
      {
        requestId: `state_${Date.now()}`,
        payload: { sku, device },
      },
    );
    return resp.data?.capabilities ?? [];
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
  async controlDevice(
    sku: string,
    device: string,
    capabilityType: string,
    instance: string,
    value: unknown,
  ): Promise<void> {
    await this.request("POST", "/router/api/v1/device/control", {
      requestId: `ctrl_${Date.now()}`,
      payload: {
        sku,
        device,
        capability: {
          type: capabilityType,
          instance,
          value,
        },
      },
    });
  }

  /**
   * Make an HTTPS request to the Govee Cloud API
   *
   * @param method HTTP method (GET, POST)
   * @param path API endpoint path
   * @param body Optional request body
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.log.debug(`Cloud API: ${method} ${path}`);
    try {
      return await httpsRequest<T>({
        method: method as "GET" | "POST",
        url: new URL(path, BASE_URL).toString(),
        headers: { "Govee-API-Key": this.apiKey },
        body,
      });
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 429) {
        const retryAfter = String(err.headers["retry-after"] ?? "unknown");
        throw new HttpError(
          `Rate limited — retry after ${retryAfter}s`,
          429,
          err.headers,
        );
      }
      throw err;
    }
  }
}
