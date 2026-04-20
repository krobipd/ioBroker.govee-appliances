import { httpsRequest } from "./http-client.js";
import {
  GOVEE_APP_BASE_URL,
  GOVEE_APP_VERSION,
  GOVEE_CLIENT_ID,
  GOVEE_CLIENT_TYPE,
  GOVEE_USER_AGENT,
} from "./govee-constants.js";

/**
 * Parsed representation of the per-device `lastDeviceData` string that Govee
 * embeds (stringified) in the undocumented device-list response. Temperature
 * and humidity are transmitted as integer hundredths (`tem: 2370` → 23.70).
 */
export interface AppDeviceLastData {
  /** Online flag as reported by the cloud */
  online?: boolean;
  /** Last known temperature in tenths of a degree — `tem/100` = °C */
  tem?: number;
  /** Last known humidity in tenths of a percent — `hum/100` = % RH */
  hum?: number;
  /** Last known battery percentage (only some devices report it here) */
  battery?: number;
  /** UNIX ms of the last data point */
  lastTime?: number;
}

/**
 * Parsed representation of the per-device `deviceSettings` string. Fields
 * are a union of what different SKUs report — most are optional.
 */
export interface AppDeviceSettings {
  /** Upload interval in minutes (how often the device pushes to the cloud) */
  uploadRate?: number;
  /** Battery percentage — some firmware puts it here, others in lastData */
  battery?: number;
  /** SSID the device is currently associated with */
  wifiName?: string;
  /** MAC address of the device's WiFi interface */
  wifiMac?: string;
  /** Current WiFi firmware version */
  wifiSoftVersion?: string;
  /** WiFi hardware revision */
  wifiHardVersion?: string;
  /** BLE advertising name — used when pairing through the Govee app */
  bleName?: string;
  /** Temperature calibration offset in hundredths (0 = uncalibrated) */
  temCali?: number;
  /** Humidity calibration offset in hundredths (0 = uncalibrated) */
  humCali?: number;
  /** Lower temperature warning threshold in hundredths of a degree */
  temMin?: number;
  /** Upper temperature warning threshold in hundredths of a degree */
  temMax?: number;
  /** Lower humidity warning threshold in hundredths of a percent */
  humMin?: number;
  /** Upper humidity warning threshold in hundredths of a percent */
  humMax?: number;
  /** Whether the app shows °F instead of °C (purely display-side) */
  fahOpen?: boolean;
  /** Any other field Govee may add — keys are vendor-defined */
  [key: string]: unknown;
}

/**
 * One entry in the undocumented device-list response.
 */
export interface AppDeviceEntry {
  /** Govee SKU (e.g. "H5179") */
  sku: string;
  /** Device identifier (colon-separated MAC form) */
  device: string;
  /** Display name set in the Govee Home app */
  deviceName: string;
  /** Parsed lastDeviceData (the raw string is decoded on load) */
  lastData?: AppDeviceLastData;
  /** Parsed deviceSettings */
  settings?: AppDeviceSettings;
  /** Numeric device id from Govee (internal; unused) */
  deviceId?: number;
  /** Hardware firmware version reported at the top level */
  versionHard?: string;
  /** Software firmware version reported at the top level */
  versionSoft?: string;
}

/**
 * Client for Govee's undocumented app API — used exclusively for devices that
 * the official OpenAPI v2 doesn't expose state for. Shares the bearer token
 * obtained via the MQTT login flow; no separate credentials needed.
 */
export class GoveeAppApiClient {
  private bearerToken: string | null = null;

  /**
   * Update the bearer token (obtained from MQTT login).
   *
   * @param token Fresh bearer token from Govee login
   */
  setBearerToken(token: string): void {
    this.bearerToken = token;
  }

  /** Whether a token is available. */
  hasBearerToken(): boolean {
    return !!this.bearerToken;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      appVersion: GOVEE_APP_VERSION,
      clientId: GOVEE_CLIENT_ID,
      clientType: GOVEE_CLIENT_TYPE,
      "User-Agent": GOVEE_USER_AGENT,
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
  async fetchDeviceList(): Promise<AppDeviceEntry[]> {
    if (!this.bearerToken) {
      return [];
    }
    const resp = await httpsRequest<{
      status?: number;
      message?: string;
      devices?: Array<{
        sku?: string;
        device?: string;
        deviceName?: string;
        deviceId?: number;
        versionHard?: string;
        versionSoft?: string;
        deviceExt?: {
          lastDeviceData?: string;
          deviceSettings?: string;
        };
      }>;
    }>({
      method: "POST",
      url: `${GOVEE_APP_BASE_URL}/device/rest/devices/v1/list`,
      headers: this.authHeaders(),
      body: {},
    });

    const out: AppDeviceEntry[] = [];
    const list = Array.isArray(resp?.devices) ? resp.devices : [];
    for (const d of list) {
      if (!d || typeof d.sku !== "string" || typeof d.device !== "string") {
        continue;
      }
      const entry: AppDeviceEntry = {
        sku: d.sku,
        device: d.device,
        deviceName: typeof d.deviceName === "string" ? d.deviceName : d.sku,
        deviceId: typeof d.deviceId === "number" ? d.deviceId : undefined,
        versionHard:
          typeof d.versionHard === "string" ? d.versionHard : undefined,
        versionSoft:
          typeof d.versionSoft === "string" ? d.versionSoft : undefined,
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

/**
 * Safely parse the `lastDeviceData` field. Govee serializes it as a JSON
 * string even though the outer response is already JSON. Malformed or
 * missing input yields `undefined` rather than throwing.
 *
 * @param raw Stringified JSON payload from `deviceExt.lastDeviceData`
 */
export function parseLastData(
  raw: string | undefined,
): AppDeviceLastData | undefined {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: AppDeviceLastData = {};
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
    return undefined;
  }
}

/**
 * Safely parse the `deviceSettings` field. Returns a plain object — all
 * downstream consumers should treat every property as optional.
 *
 * @param raw Stringified JSON payload from `deviceExt.deviceSettings`
 */
export function parseSettings(
  raw: string | undefined,
): AppDeviceSettings | undefined {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }
  try {
    const obj = JSON.parse(raw) as AppDeviceSettings;
    return obj && typeof obj === "object" ? obj : undefined;
  } catch {
    return undefined;
  }
}
