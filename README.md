# ioBroker.govee-appliances

[![NPM version](https://img.shields.io/npm/v/iobroker.govee-appliances.svg)](https://www.npmjs.com/package/iobroker.govee-appliances)
[![License](https://img.shields.io/npm/l/iobroker.govee-appliances.svg)](https://github.com/krobipd/ioBroker.govee-appliances/blob/main/LICENSE)

Control Govee smart home appliances (heaters, fans, humidifiers, purifiers, sensors) via Cloud API and MQTT.

> **Alpha** — This adapter is in early development. It requires testers with Govee appliance hardware.

## Supported devices

All Govee/GoveeLife WiFi appliances supported by the Govee API v2:

- Heaters (H7130-H7135)
- Humidifiers (H7140-H7142, H7160)
- Air Purifiers (H7120-H7126)
- Tower Fans (H7100-H7106)
- Dehumidifiers (H7150-H7151)
- Smart Plugs (H5080-H5083)
- WiFi Thermometers (H5179)
- Kettles (H7170-H7173)
- Ice Makers (H7172)
- Aroma Diffusers (H7161)

BLE-only devices (e.g. H5075) are **not** supported — they require a BLE stack.

## Features

- Cloud API v2 device discovery and control
- Capability-based state generation (no SKU hardcoding)
- AWS IoT MQTT for real-time status push (optional, requires Govee account)
- OpenAPI MQTT for sensor events (water leak, ice full, etc.)
- Built-in raw data logging for protocol research

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| API Key | Yes | Govee API key from the Govee Home app |
| Email | No | Govee account email (enables MQTT real-time push) |
| Password | No | Govee account password |
| Poll Interval | No | Cloud API polling interval in seconds (default: 120) |

## Changelog

### 0.0.1 (2026-04-15)
- Initial alpha release
- Cloud API v2 device discovery
- Capability-based state generation
- Raw data logging for protocol research

## License

MIT License — see [LICENSE](LICENSE)
