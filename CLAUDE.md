# CLAUDE.md — ioBroker.govee-appliances

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Govee Appliances Adapter** — Steuert Govee Non-Lighting-Geräte (Heater, Fan, Humidifier, Purifier, Sensoren etc.) via Cloud API v2 + optional AWS IoT MQTT.

- **Version:** 0.0.7 (Alpha, April 2026) — 177 custom + 57 package + integration tests, Build+Lint sauber, KEIN npm
- **GitHub:** https://github.com/krobipd/ioBroker.govee-appliances
- **Runtime-Deps:** `@iobroker/adapter-core`, `@iobroker/types`, `mqtt`, `node-forge`
- **Hotfixes 0.0.2 → 0.0.6:** BaseGroup-Filter, async-handler crash-loop fix, Type-Guards für API-Drift, in-memory state cache, dead-code removal, capability-mapper guards für fehlende `parameters`, vollständige API-Drift-Härtung (instance/fieldName/device-ID guards + String-zu-Number/Bool-Coercion)

## Scope

**Included:** Heater, Humidifier, Purifier, Fan, Dehumidifier, Kettle, Ice Maker, Aroma Diffuser, Smart Plug, WiFi Thermometer, Sensoren
**Excluded:** Lights (→ govee-smart), BLE-only Sensoren (braucht BLE-Stack)

## KRITISCH: Cloud-only!

- **Kein LAN-API für Appliances** — Hardware-Limitation, nicht Software
- Cloud API v2 (`openapi.api.govee.com`) für Steuerung + Status
- AWS IoT MQTT für Echtzeit Status-Push (optional, braucht Email+PW)
- OpenAPI MQTT (`mqtt.openapi.govee.com:8883`) für Sensor-Events (nur API Key)

## Verbindungs-Priorität

| Priorität | Kanal | Voraussetzung | Liefert |
|-----------|-------|---------------|---------|
| 1. | AWS IoT MQTT | Email+Passwort | Echtzeit Status-Push, Raw BLE Pakete |
| 2. | Cloud API v2 (Polling) | API Key | Geräteliste, Capabilities, Steuerung, Status |
| 3. | OpenAPI MQTT (Events) | API Key | Echtzeit Sensor-Events (Alarme) |

## Credential-Stufen

| Eingabe | Funktionsumfang |
|---------|----------------|
| API Key only | Geräteliste, Capabilities, Steuerung, Status-Polling, Sensor-Events |
| + Email/Passwort | + Echtzeit Status-Push via AWS IoT MQTT |

## Koexistenz mit govee-smart!

Gleicher API Key → gleiches 10.000/Tag Budget. **Dynamische Erkennung** via `system.adapter.govee-smart.0.alive`:
- **Allein:** 8/min, 9000/day (volle Limits)
- **Beide aktiv:** 4/min, 4500/day je Adapter (automatisch per subscribeForeignStatesAsync)
- MQTT nutzt unique Client-IDs → parallele Verbindungen funktionieren
- Spiegelgleiche Logik in govee-smart (`system.adapter.govee-appliances.0.alive`)

## Architektur

```
src/main.ts                           → Lifecycle, StateChange, Polling, Diagnostics
src/lib/device-manager.ts             → Device-Map, Cloud-Loading, MQTT Status, OpenAPI Events
src/lib/capability-mapper.ts          → Capability → StateDefinition Mapping
src/lib/state-manager.ts              → State CRUD + Channels (info/control/sensor/events/raw)
src/lib/govee-cloud-client.ts         → Cloud REST API v2
src/lib/govee-mqtt-client.ts          → AWS IoT MQTT (Auth + Status-Push + Raw BLE)
src/lib/govee-openapi-mqtt-client.ts  → OpenAPI MQTT (Sensor Events, API Key only)
src/lib/types.ts                      → Interfaces + Shared Utilities
src/lib/http-client.ts                → Shared HTTPS request
src/lib/rate-limiter.ts               → Rate Limits für Cloud REST
src/lib/sku-cache.ts                  → Persistent Device/Capability Cache
```

## State Tree

```
govee-appliances.0.
├── info.connection
├── info.mqttConnected
├── info.openapiMqttConnected
├── devices.
│   └── h7131_abcd.
│       ├── info.name / .model / .online
│       ├── control.power / .workMode / .targetTemperature / ...
│       ├── sensor.temperature / .humidity (read-only)
│       ├── events.lackWater (read-only, MQTT)
│       └── raw.diagnostics_export / .diagnostics_result / .mqttLastPackets / .mqttPacketCount / .openapiLastEvents / .openapiEventCount / .apiCapabilities / .apiLastStateResponse
```

## Raw-Data Namespace (Research)

Jedes Gerät hat `raw.*` States für Protokoll-Forschung (8 States):
- `raw.diagnostics_export` — Button: exportiert strukturiertes JSON
- `raw.diagnostics_result` — JSON String mit Capabilities, API-Responses, MQTT+OpenAPI Stats
- `raw.mqttLastPackets` — Letzte 50 MQTT `op.command` BLE-Pakete
- `raw.mqttPacketCount` — Gesamtzahl empfangener BLE-Pakete
- `raw.openapiLastEvents` — Letzte 50 OpenAPI MQTT Events (JSON Array)
- `raw.openapiEventCount` — Gesamtzahl empfangener OpenAPI Events
- `raw.apiCapabilities` — Vollständiger Capability-Dump
- `raw.apiLastStateResponse` — Letzte /device/state Response

## Design-Prinzipien

1. **Cloud first** — kein LAN verfügbar, API v2 ist der Hauptkanal
2. **Capability-driven** — kein SKU-Hardcoding, States aus API generiert
3. **Graceful degradation** — mit nur API Key funktioniert alles außer MQTT-Push
4. **Raw-Data eingebaut** — Rohdaten-Logging für Protokoll-Research
5. **Shared Utilities** — http-client, rate-limiter, types aus govee-smart
6. **Device-Quirks** — SKU-spezifische Korrekturen (H7160 broken API, H5080 Power-Werte)

## Befehle

```bash
npm run build        # Production (esbuild)
npm run build:test   # Test build (tsc)
npm test             # Build + mocha
npm run lint         # ESLint + Prettier
```

## Roadmap

### Phase 1: Cloud API MVP (DONE)
- [x] Projekt-Grundgerüst
- [x] Cloud API Client (govee-cloud-client.ts)
- [x] Capability Mapper (capability-mapper.ts)
- [x] State Manager (state-manager.ts, 4 Channels: control/sensor/events/raw)
- [x] Device Manager + main.ts (Lifecycle, StateChange, Polling, Diagnostics)
- [x] Admin UI (jsonConfig + 11 Sprachen)
- [x] Tests (193→203 Tests, 8 Testdateien)
- [x] Koexistenz govee-smart (dynamische Rate-Limit-Erkennung)

### Phase 2: MQTT + Raw Data (DONE)
- [x] AWS IoT MQTT Client
- [x] Raw-Data States (8 raw states pro Gerät)
- [x] Diagnostics Export (strukturiert: capabilities, iotMqtt, openapiMqtt, lastCloudState)
- [x] OpenAPI MQTT Events (govee-openapi-mqtt-client.ts)
- [x] Event-Mapping in CapabilityMapper (event → boolean in events channel)
- [x] apiLastStateResponse wird bei jedem Cloud-Poll aktualisiert
- [x] OpenAPI raw ring-buffer (50 Events) + openapiLastEvents/openapiEventCount States

### Phase 3: BLE Research
- [ ] ptRealTest Button
- [ ] Paket-Analyse
- [ ] Community-Tester

### Phase 4: IoT MQTT Steuerung
- [ ] BLE-basierte Steuerung via MQTT
- [ ] Cloud als Fallback
