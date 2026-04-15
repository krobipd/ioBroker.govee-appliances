# ioBroker.govee-appliances

[![npm version](https://img.shields.io/npm/v/iobroker.govee-appliances)](https://www.npmjs.com/package/iobroker.govee-appliances)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.govee-appliances)](https://www.npmjs.com/package/iobroker.govee-appliances)
![Installations](https://iobroker.live/badges/govee-appliances-installed.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

<img src="https://raw.githubusercontent.com/krobipd/ioBroker.govee-appliances/main/admin/govee-appliances.svg" width="100" />

Control [Govee](https://www.govee.com/) smart home appliances (heaters, fans, humidifiers, purifiers, sensors) via Cloud API and MQTT.

> **Alpha — Testers wanted!** This adapter discovers and controls Govee appliances, but has not been tested with real hardware yet. If you own a Govee heater, fan, humidifier, purifier, or similar device — your data helps make this adapter work for everyone. See [How to help](#how-to-help-share-your-device-data) below.

---

## How to help: Share your device data

This adapter generates states dynamically from whatever the Govee API reports for your device. To verify that this works correctly, we need real diagnostics data from as many devices as possible.

**What to do:**

1. Install the adapter, enter your Govee API key (and optionally email + password for MQTT)
2. Wait for the adapter to discover your devices (check the log)
3. In the ioBroker object tree, find your device under `govee-appliances.0.devices.<your_device>.raw`
4. Click the **`diagnostics_export`** button (set the state to `true`)
5. Copy the content of **`diagnostics_result`** — this is a JSON with your device's capabilities, API responses, and connection data
6. Open a [GitHub Issue](https://github.com/krobipd/ioBroker.govee-appliances/issues) with:
   - Your device model (e.g. H7131)
   - The diagnostics JSON
   - What works, what doesn't

**What gets collected:** Only data the Govee API returns (capabilities, state responses, MQTT packets). No personal data, no credentials, no IP addresses.

---

## Features

- **Cloud API v2** — Device discovery, capability-based state generation, control, status polling
- **AWS IoT MQTT** — Real-time status push and raw BLE packet capture (optional, requires Govee account)
- **OpenAPI MQTT** — Real-time sensor events like water leak, ice full, presence detection (API key only)
- **Capability-driven** — No SKU hardcoding, states generated dynamically from API capabilities
- **Coexistence** — Shares API budget dynamically with govee-smart (automatic detection)
- **Built-in diagnostics** — Raw data logging for protocol research, one-click export per device

---

## Supported Devices

All Govee/GoveeLife WiFi appliances supported by the Govee API v2:

| Category | Models |
|----------|--------|
| Heaters | H7130, H7131, H7132, H7133, H7134, H7135, H713A, H713B |
| Humidifiers | H7140, H7141, H7142, H7160 |
| Air Purifiers | H7120, H7121, H7122 |
| Tower Fans | H7100, H7101, H7102, H7106 |
| Dehumidifiers | H7150, H7151 |
| Smart Plugs | H5080, H5081, H5083 |
| WiFi Thermometers | H5179 |
| Kettles | H7170, H7171, H7173 |
| Ice Makers | H7172 |
| Aroma Diffusers | H7161 |

BLE-only devices (e.g. H5075) are **not** supported — they require a BLE stack.

---

## Requirements

- **Node.js >= 20**
- **ioBroker js-controller >= 7.0.0**
- **ioBroker Admin >= 7.6.20**
- **Govee API Key** — Get it in the Govee Home app: Account > Settings > About Us > Apply for API Key

---

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| API Key | Yes | Govee API key from the Govee Home app |
| Email | No | Govee account email (enables AWS IoT MQTT real-time push) |
| Password | No | Govee account password |
| Poll Interval | No | Cloud API polling interval in seconds (default: 120, min: 30) |

### Connection Channels

| Channel | Requires | Provides |
|---------|----------|----------|
| Cloud API v2 (REST) | API Key | Device list, capabilities, control, status polling |
| AWS IoT MQTT | Email + Password | Real-time status push, raw BLE packets |
| OpenAPI MQTT | API Key only | Real-time sensor events (alarms) |

### Coexistence with govee-smart

Both adapters share the same Govee API key and daily rate limit (10,000 calls/day). When both are running, each adapter automatically reduces its rate to 4 calls/min and 4,500 calls/day.

---

## State Tree

```
govee-appliances.0.
├── info.connection                  Cloud API connected
├── info.mqttConnected               AWS IoT MQTT connected
├── info.openapiMqttConnected        OpenAPI MQTT connected
└── devices.
    └── h7131_ab3f.                  (SKU + short device ID)
        ├── info.name                Device name
        ├── info.model               SKU model
        ├── info.online              Device reachable
        ├── control.power            On/Off
        ├── control.work_mode        Work mode (dropdown)
        ├── control.mode_value       Mode value (per work mode)
        ├── control.target_temperature  Target temperature
        ├── control.oscillation_toggle  Oscillation
        ├── sensor.sensor_temperature   Current temperature (read-only)
        ├── sensor.sensor_humidity      Current humidity (read-only)
        ├── events.lack_water_event     Water tank empty (read-only)
        ├── events.ice_full             Ice container full (read-only)
        └── raw.
            ├── diagnostics_export      Button: export diagnostics JSON
            ├── diagnostics_result      Diagnostics JSON output
            ├── mqttLastPackets         Last 50 AWS IoT MQTT BLE packets
            ├── mqttPacketCount         Total BLE packets received
            ├── openapiLastEvents       Last 50 OpenAPI MQTT events
            ├── openapiEventCount       Total OpenAPI events received
            ├── apiCapabilities         Full capability dump from API
            └── apiLastStateResponse    Last Cloud API state response
```

States under `control.*` are generated dynamically from the device's capabilities. The exact states depend on the device type.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No devices found | Check API key in adapter settings. Open the Govee Home app and verify devices are visible there. |
| MQTT not connecting | Check email/password. AWS IoT MQTT requires Govee account credentials, not just the API key. |
| Event states always false | OpenAPI MQTT events only fire when the event actually occurs (e.g. water tank runs empty). |
| Rate limit errors (429) | Increase polling interval. If govee-smart is also running, both adapters share the 10,000/day budget automatically. |
| States missing for a device | The adapter generates states from API capabilities. If a device reports no capabilities, check `raw.apiCapabilities` for the raw data. |

---

### Support Development

If you find this adapter useful, consider supporting the development:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

---

## Changelog

### **WORK IN PROGRESS**

### 0.0.2 (2026-04-15)
- Fix: Event states now update correctly from OpenAPI MQTT
- Fix: Cloud API state response stored on every poll
- Added OpenAPI MQTT raw data states (openapiLastEvents, openapiEventCount)
- Improved diagnostics export with MQTT and OpenAPI statistics
- GitHub issue templates for device data collection and bug reports

### 0.0.1 (2026-04-15)
- Initial alpha release
- Cloud API v2 device discovery and control
- Capability-based state generation
- AWS IoT MQTT for real-time status push
- OpenAPI MQTT for sensor events
- Raw data logging for protocol research
- Dynamic rate limit sharing with govee-smart

Older entries have been moved to [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

---

## License

MIT License

Copyright (c) 2026 krobi <krobi@power-dreams.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

*Built with the help of [Claude Code](https://claude.ai/claude-code)*
