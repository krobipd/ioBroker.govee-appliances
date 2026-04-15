/** Adapter configuration from ioBroker native config */
export interface AdapterConfig {
  /** Govee Cloud API key (required) */
  apiKey: string;
  /** Govee account email (optional — enables MQTT real-time status) */
  goveeEmail: string;
  /** Govee account password (optional — enables MQTT real-time status) */
  goveePassword: string;
  /** Cloud API polling interval in seconds (default 120) */
  pollInterval: number;
}

// --- Cloud API v2 Types ---

/** Device from Cloud API GET /router/api/v1/user/devices */
export interface CloudDevice {
  /** Product model (e.g. H7131) */
  sku: string;
  /** Unique device identifier */
  device: string;
  /** User-assigned device name */
  deviceName: string;
  /** Device category (e.g. "devices.types.heater") */
  type: string;
  /** Device capabilities from Cloud API */
  capabilities: CloudCapability[];
}

/** A single capability from the Cloud API */
export interface CloudCapability {
  /** Capability type (e.g. "devices.capabilities.on_off") */
  type: string;
  /** Capability instance (e.g. "powerSwitch", "brightness") */
  instance: string;
  /** Parameter definition for this capability */
  parameters: CapabilityParameters;
  /** Alarm type for event capabilities */
  alarmType?: number;
  /** Event state options for event capabilities */
  eventState?: { options: CapabilityOption[] };
}

/** Parameter definition for a capability */
export interface CapabilityParameters {
  /** Value data type */
  dataType: "ENUM" | "INTEGER" | "STRUCT" | "Array";
  /** Available options for ENUM type */
  options?: CapabilityOption[];
  /** Value range for INTEGER type */
  range?: { min: number; max: number; precision: number };
  /** Unit of measurement */
  unit?: string;
  /** Field definitions for STRUCT type */
  fields?: CapabilityField[];
}

/** ENUM option */
export interface CapabilityOption {
  /** Display name of the option */
  name: string;
  /** Option value */
  value: number | string | Record<string, unknown>;
  /** Event message (for event capabilities) */
  message?: string;
}

/** STRUCT field definition */
export interface CapabilityField {
  /** Field name identifier */
  fieldName: string;
  /** Value data type */
  dataType?: "ENUM" | "INTEGER" | "STRUCT" | "Array";
  /** Available options for ENUM fields */
  options?: CapabilityOption[];
  /** Value range for INTEGER fields */
  range?: { min: number; max: number; precision: number };
  /** Whether this field is required */
  required?: boolean;
}

/** Cloud API device list response */
export interface CloudDeviceListResponse {
  /** Response status code */
  code: number;
  /** Response message */
  message: string;
  /** List of devices */
  data: CloudDevice[];
}

/** Cloud API device state response */
export interface CloudDeviceStateResponse {
  /** Response status code */
  code: number;
  /** Response message */
  message: string;
  /** Device state data */
  data: {
    /** Product model */
    sku: string;
    /** Device identifier */
    device: string;
    /** Current capability states */
    capabilities: CloudStateCapability[];
  };
}

/** A capability value from state response */
export interface CloudStateCapability {
  /** Capability type */
  type: string;
  /** Capability instance */
  instance: string;
  /** Current state value */
  state: { value: unknown };
}

// --- AWS IoT MQTT Types ---

/** Login response from app2.govee.com */
export interface GoveeLoginResponse {
  /** API status code (200 = success) */
  status?: number;
  /** API status message */
  message?: string;
  /** Client authentication data (missing on auth failure) */
  client?: {
    /** Bearer token for API calls */
    token: string;
    /** Account identifier (numeric) */
    accountId: number | string;
    /** MQTT topic for status updates */
    topic: string;
  };
}

/** IoT key response from app2.govee.com */
export interface GoveeIotKeyResponse {
  /** IoT credential data */
  data?: {
    /** AWS IoT endpoint hostname */
    endpoint: string;
    /** Base64-encoded PKCS12 certificate */
    p12: string;
    /** Password for the PKCS12 certificate */
    p12Pass: string;
  };
}

/** MQTT status update received on account topic */
export interface MqttStatusUpdate {
  /** Product model */
  sku: string;
  /** Device identifier */
  device: string;
  /** Device state values */
  state?: Record<string, unknown>;
  /** Operation data (contains BLE packets) */
  op?: {
    /** Base64-encoded BLE command packets */
    command?: string[];
    /** Mode value data */
    modeValue?: unknown[];
    /** Sleep value data */
    sleepValue?: unknown[];
  };
}

// --- OpenAPI MQTT Event Types ---

/** Event message from OpenAPI MQTT (mqtt.openapi.govee.com:8883) */
export interface OpenApiMqttEvent {
  /** Product model */
  sku: string;
  /** Device identifier */
  device: string;
  /** Event capabilities (typically event type) */
  capabilities: CloudStateCapability[];
}

// --- Internal Device Model ---

/** Known appliance device types from Cloud API */
export type ApplianceType =
  | "devices.types.heater"
  | "devices.types.humidifier"
  | "devices.types.air_purifier"
  | "devices.types.fan"
  | "devices.types.dehumidifier"
  | "devices.types.thermometer"
  | "devices.types.sensor"
  | "devices.types.socket"
  | "devices.types.ice_maker"
  | "devices.types.aroma_diffuser"
  | "devices.types.kettle";

/** All device types including lights (which we filter out) */
export const LIGHT_TYPES = ["devices.types.light"];

/** Unified device representation */
export interface ApplianceDevice {
  /** Product model (e.g. H7131) */
  sku: string;
  /** Unique device ID */
  deviceId: string;
  /** Display name (from Cloud) */
  name: string;
  /** Device type from Cloud API */
  type: string;
  /** Capabilities from Cloud API */
  capabilities: CloudCapability[];
  /** Last known state values (keyed by capability instance) */
  state: Record<string, unknown>;
  /** Whether device is online */
  online: boolean;
  /** Last raw Cloud API state response (JSON for diagnostics) */
  lastCloudStateResponse: string;
  /** Raw MQTT packets ring buffer (last 50) — AWS IoT */
  rawMqttPackets: Array<{ timestamp: number; packets: string[] }>;
  /** Total MQTT packets received — AWS IoT */
  rawMqttPacketCount: number;
  /** Raw OpenAPI MQTT events ring buffer (last 50) */
  rawOpenapiEvents: Array<{ timestamp: number; data: string }>;
  /** Total OpenAPI MQTT events received */
  rawOpenapiEventCount: number;
}

// --- Shared Utilities ---

/**
 * Normalize device ID — remove colons, lowercase
 *
 * @param id Identifier string
 */
export function normalizeDeviceId(id: string): string {
  return id.replace(/:/g, "").toLowerCase();
}

/** Error categories for dedup logging */
export type ErrorCategory =
  | "NETWORK"
  | "TIMEOUT"
  | "AUTH"
  | "RATE_LIMIT"
  | "UNKNOWN";

/**
 * Classify an error into a category for dedup logging.
 *
 * @param err Error to classify
 */
export function classifyError(err: unknown): ErrorCategory {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ECONNREFUSED" ||
      code === "EHOSTUNREACH" ||
      code === "ENOTFOUND" ||
      code === "ENETUNREACH" ||
      code === "ECONNRESET" ||
      code === "EAI_AGAIN"
    ) {
      return "NETWORK";
    }
    if (code === "ETIMEDOUT" || err.message.includes("timed out")) {
      return "TIMEOUT";
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ENETUNREACH") ||
    msg.includes("ECONNRESET")
  ) {
    return "NETWORK";
  }
  if (msg.includes("Timeout")) {
    return "TIMEOUT";
  }
  if (
    msg.includes("429") ||
    msg.includes("Rate limit") ||
    msg.includes("Rate limited")
  ) {
    return "RATE_LIMIT";
  }
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("Login failed") ||
    msg.includes("auth")
  ) {
    return "AUTH";
  }
  return "UNKNOWN";
}

/** Timer/callback interfaces for helper classes */
export interface TimerAdapter {
  /** Set a recurring timer */
  setInterval(callback: () => void, ms: number): ioBroker.Interval | undefined;
  /** Clear a recurring timer */
  clearInterval(timer: ioBroker.Interval): void;
  /** Set a one-shot timer */
  setTimeout(callback: () => void, ms: number): ioBroker.Timeout | undefined;
  /** Clear a one-shot timer */
  clearTimeout(timer: ioBroker.Timeout): void;
}

/**
 * Extract short ID from device ID (last 4 hex chars).
 *
 * @param deviceId Device identifier
 */
export function shortDeviceId(deviceId: string): string {
  const normalized = normalizeDeviceId(deviceId);
  return normalized.slice(-4);
}

/**
 * Build folder name for a device: sku_shortId (e.g. "h7131_ab3f")
 *
 * @param sku sku
 * @param deviceId Device identifier
 */
export function devicePrefix(sku: string, deviceId: string): string {
  return `${sku.toLowerCase()}_${shortDeviceId(deviceId)}`;
}

/**
 * Normalize unit string from Cloud API to ioBroker display format.
 *
 * @param unit unit
 */
export function normalizeUnit(unit?: string): string | undefined {
  if (!unit) {
    return undefined;
  }
  const map: Record<string, string> = {
    "unit.percent": "%",
    "unit.kelvin": "K",
    "unit.celsius": "°C",
    "unit.fahrenheit": "°F",
  };
  return map[unit] ?? unit;
}
