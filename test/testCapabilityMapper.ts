import { expect } from "chai";
import {
    mapCapabilities,
    mapCloudStateValue,
    buildDeviceStateDefs,
} from "../src/lib/capability-mapper";
import type { CloudCapability, CloudStateCapability, ApplianceDevice } from "../src/lib/types";

describe("CapabilityMapper", () => {
    describe("mapCapabilities", () => {
        it("should map on_off to boolean power state", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                parameters: { dataType: "ENUM", options: [{ name: "off", value: 0 }, { name: "on", value: 1 }] },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("power");
            expect(result[0].type).to.equal("boolean");
            expect(result[0].role).to.equal("switch");
            expect(result[0].write).to.be.true;
            expect(result[0].def).to.equal(false);
        });

        it("should map toggle to boolean switch", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.toggle",
                instance: "oscillationToggle",
                parameters: { dataType: "ENUM", options: [{ name: "off", value: 0 }, { name: "on", value: 1 }] },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("oscillation_toggle");
            expect(result[0].type).to.equal("boolean");
            expect(result[0].role).to.equal("switch");
        });

        it("should map range brightness with min/max", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.range",
                instance: "brightness",
                parameters: { dataType: "INTEGER", range: { min: 0, max: 100, precision: 1 }, unit: "unit.percent" },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("brightness");
            expect(result[0].role).to.equal("level.brightness");
            expect(result[0].min).to.equal(0);
            expect(result[0].max).to.equal(100);
            expect(result[0].unit).to.equal("%");
        });

        it("should map range humidity", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.range",
                instance: "humidity",
                parameters: { dataType: "INTEGER", range: { min: 40, max: 80, precision: 1 }, unit: "unit.percent" },
            }];

            const result = mapCapabilities(caps);
            expect(result[0].id).to.equal("humidity");
            expect(result[0].min).to.equal(40);
            expect(result[0].max).to.equal(80);
            expect(result[0].unit).to.equal("%");
        });

        it("should map work_mode STRUCT with mode + value dropdowns", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                parameters: {
                    dataType: "STRUCT",
                    fields: [
                        {
                            fieldName: "workMode",
                            dataType: "ENUM",
                            options: [
                                { name: "LargeIce", value: 1 },
                                { name: "MediumIce", value: 2 },
                                { name: "SmallIce", value: 3 },
                            ],
                            required: true,
                        },
                        {
                            fieldName: "modeValue",
                            dataType: "ENUM",
                            options: [
                                { name: "Low", value: 0 },
                                { name: "High", value: 1 },
                            ],
                        },
                    ],
                },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(2);

            const workMode = result.find((s) => s.id === "work_mode");
            expect(workMode).to.exist;
            expect(workMode!.type).to.equal("number");
            expect(workMode!.states).to.deep.include({ "1": "LargeIce", "2": "MediumIce", "3": "SmallIce" });

            const modeValue = result.find((s) => s.id === "mode_value");
            expect(modeValue).to.exist;
            expect(modeValue!.states).to.deep.include({ "0": "Low", "1": "High" });
        });

        it("should map work_mode without fields as JSON fallback", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                parameters: { dataType: "STRUCT" },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("work_mode");
            expect(result[0].role).to.equal("json");
        });

        it("should map work_mode with range modeValue", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                parameters: {
                    dataType: "STRUCT",
                    fields: [
                        {
                            fieldName: "workMode",
                            dataType: "ENUM",
                            options: [{ name: "Manual", value: 1 }],
                        },
                        {
                            fieldName: "modeValue",
                            dataType: "INTEGER",
                            range: { min: 1, max: 9, precision: 1 },
                        },
                    ],
                },
            }];

            const result = mapCapabilities(caps);
            const modeValue = result.find((s) => s.id === "mode_value");
            expect(modeValue).to.exist;
            expect(modeValue!.min).to.equal(1);
            expect(modeValue!.max).to.equal(9);
        });

        it("should map temperature_setting with STRUCT field", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.temperature_setting",
                instance: "targetTemperature",
                parameters: {
                    dataType: "STRUCT",
                    unit: "unit.fahrenheit",
                    fields: [
                        {
                            fieldName: "targetTemperature",
                            dataType: "INTEGER",
                            range: { min: 41, max: 95, precision: 1 },
                        },
                    ],
                },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("target_temperature");
            expect(result[0].role).to.equal("level.temperature");
            expect(result[0].min).to.equal(41);
            expect(result[0].max).to.equal(95);
            expect(result[0].unit).to.equal("°F");
        });

        it("should map temperature_setting with simple range", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.temperature_setting",
                instance: "targetTemperature",
                parameters: {
                    dataType: "INTEGER",
                    range: { min: 5, max: 35, precision: 1 },
                    unit: "unit.celsius",
                },
            }];

            const result = mapCapabilities(caps);
            expect(result[0].min).to.equal(5);
            expect(result[0].max).to.equal(35);
            expect(result[0].unit).to.equal("°C");
        });

        it("should map property as read-only sensor state", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.property",
                instance: "sensorTemperature",
                parameters: { dataType: "INTEGER", unit: "unit.celsius" },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("sensor_temperature");
            expect(result[0].role).to.equal("value.temperature");
            expect(result[0].write).to.be.false;
            expect(result[0].channel).to.equal("sensor");
            expect(result[0].unit).to.equal("°C");
        });

        it("should map humidity property", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.property",
                instance: "sensorHumidity",
                parameters: { dataType: "INTEGER", unit: "unit.percent" },
            }];

            const result = mapCapabilities(caps);
            expect(result[0].role).to.equal("value.humidity");
            expect(result[0].unit).to.equal("%");
        });

        it("should map event as alarm indicator in events channel", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.event",
                instance: "lackWaterEvent",
                alarmType: 51,
                parameters: { dataType: "ENUM" },
                eventState: { options: [{ name: "lack", value: 1, message: "Lack of Water" }] },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("lack_water_event");
            expect(result[0].type).to.equal("boolean");
            expect(result[0].role).to.equal("indicator.alarm");
            expect(result[0].write).to.be.false;
            expect(result[0].channel).to.equal("events");
        });

        it("should map colorRgb to string state", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.color_setting",
                instance: "colorRgb",
                parameters: { dataType: "INTEGER", range: { min: 0, max: 16777215, precision: 1 } },
            }];

            const result = mapCapabilities(caps);
            expect(result[0].id).to.equal("color_rgb");
            expect(result[0].type).to.equal("string");
            expect(result[0].role).to.equal("level.color.rgb");
        });

        it("should skip online capability", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.online",
                instance: "online",
                parameters: { dataType: "ENUM" },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(0);
        });

        it("should skip unknown capability types", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.unknown_future_type",
                instance: "something",
                parameters: { dataType: "ENUM" },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(0);
        });

        it("should map mode with ENUM options", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.mode",
                instance: "nightlightScene",
                parameters: {
                    dataType: "ENUM",
                    options: [
                        { name: "Warm", value: 1 },
                        { name: "Cool", value: 2 },
                    ],
                },
            }];

            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].id).to.equal("nightlight_scene");
            expect(result[0].states).to.deep.include({ "1": "Warm", "2": "Cool" });
        });

        // Regression: Cloud API can omit `parameters` entirely. Every map function
        // must survive that without throwing — see crash report 2026-04-17.
        it("should not throw when parameters is missing for property", () => {
            const caps: CloudCapability[] = [{
                type: "devices.capabilities.property",
                instance: "sensorTemperature",
            } as CloudCapability];
            const result = mapCapabilities(caps);
            expect(result).to.have.lengthOf(1);
            expect(result[0].channel).to.equal("sensor");
            expect(result[0].unit).to.equal("°C");
        });

        it("should not throw when parameters is missing for range/work_mode/mode/temperature_setting/color_setting", () => {
            const caps: CloudCapability[] = [
                { type: "devices.capabilities.range", instance: "brightness" } as CloudCapability,
                { type: "devices.capabilities.work_mode", instance: "workMode" } as CloudCapability,
                { type: "devices.capabilities.mode", instance: "scene" } as CloudCapability,
                { type: "devices.capabilities.temperature_setting", instance: "targetTemperature" } as CloudCapability,
                { type: "devices.capabilities.color_setting", instance: "colorTemperatureK" } as CloudCapability,
            ];
            // Must complete without throwing — individual results may be empty/fallback
            const result = mapCapabilities(caps);
            expect(result).to.be.an("array");
        });
    });

    describe("mapCloudStateValue", () => {
        it("should map on_off power state", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                state: { value: 1 },
            };
            const result = mapCloudStateValue(cap);
            expect(result).to.have.lengthOf(1);
            expect(result[0]).to.deep.equal({ stateId: "power", value: true });
        });

        it("should map on_off power off", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                state: { value: 0 },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "power", value: false });
        });

        it("should map toggle state", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.toggle",
                instance: "oscillationToggle",
                state: { value: 1 },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "oscillation_toggle", value: true });
        });

        it("should map range value", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.range",
                instance: "brightness",
                state: { value: 75 },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "brightness", value: 75 });
        });

        it("should map work_mode STRUCT to separate values", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                state: { value: { workMode: 2, modeValue: 5 } },
            };
            const result = mapCloudStateValue(cap);
            expect(result).to.have.lengthOf(2);
            expect(result[0]).to.deep.equal({ stateId: "work_mode", value: 2 });
            expect(result[1]).to.deep.equal({ stateId: "mode_value", value: 5 });
        });

        it("should handle work_mode with only workMode", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                state: { value: { workMode: 1 } },
            };
            const result = mapCloudStateValue(cap);
            expect(result).to.have.lengthOf(1);
            expect(result[0].stateId).to.equal("work_mode");
        });

        it("should handle work_mode non-object", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                state: { value: "invalid" },
            };
            const result = mapCloudStateValue(cap);
            expect(result).to.have.lengthOf(0);
        });

        it("should map temperature_setting number", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.temperature_setting",
                instance: "targetTemperature",
                state: { value: 72 },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "target_temperature", value: 72 });
        });

        it("should map temperature_setting struct", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.temperature_setting",
                instance: "targetTemperature",
                state: { value: { targetTemperature: 68 } },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "target_temperature", value: 68 });
        });

        it("should map colorRgb integer to hex string", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.color_setting",
                instance: "colorRgb",
                state: { value: 0xff6600 },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "color_rgb", value: "#ff6600" });
        });

        it("should map property to sensor channel", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.property",
                instance: "sensorTemperature",
                state: { value: 22.5 },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "sensor_temperature", value: 22.5, channel: "sensor" });
        });

        it("should map online status", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.online",
                instance: "online",
                state: { value: true },
            };
            const result = mapCloudStateValue(cap);
            expect(result[0]).to.deep.equal({ stateId: "online", value: true });
        });

        it("should return empty for null/undefined value", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                state: { value: null },
            };
            expect(mapCloudStateValue(cap)).to.have.lengthOf(0);
        });

        it("should map event to boolean in events channel", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.event",
                instance: "lackWaterEvent",
                state: { value: 1 },
            };
            const result = mapCloudStateValue(cap);
            expect(result).to.have.lengthOf(1);
            expect(result[0].stateId).to.equal("lack_water_event");
            expect(result[0].value).to.equal(true);
            expect(result[0].channel).to.equal("events");
        });

        it("should map event value 0 to false", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.event",
                instance: "iceFull",
                state: { value: 0 },
            };
            const result = mapCloudStateValue(cap);
            expect(result).to.have.lengthOf(1);
            expect(result[0].value).to.equal(false);
            expect(result[0].channel).to.equal("events");
        });

        it("should return empty for unknown capability type", () => {
            const cap: CloudStateCapability = {
                type: "devices.capabilities.unknown",
                instance: "something",
                state: { value: 42 },
            };
            expect(mapCloudStateValue(cap)).to.have.lengthOf(0);
        });
    });

    describe("buildDeviceStateDefs", () => {
        it("should add raw-data states to capability states", () => {
            const device: ApplianceDevice = {
                sku: "H7172",
                deviceId: "AA:BB:CC:DD:EE:FF:00:11",
                name: "Ice Maker",
                type: "devices.types.ice_maker",
                capabilities: [{
                    type: "devices.capabilities.on_off",
                    instance: "powerSwitch",
                    parameters: { dataType: "ENUM" },
                }],
                state: {},
                online: true,
                lastCloudStateResponse: "",
                rawMqttPackets: [],
                rawMqttPacketCount: 0,
                rawOpenapiEvents: [],
                rawOpenapiEventCount: 0,
            };

            const result = buildDeviceStateDefs(device);

            // Should have power + 8 raw states
            expect(result.length).to.be.greaterThanOrEqual(9);

            const rawStates = result.filter((s) => s.channel === "raw");
            expect(rawStates).to.have.lengthOf(8);

            const rawIds = rawStates.map((s) => s.id).sort();
            expect(rawIds).to.deep.equal([
                "apiCapabilities",
                "apiLastStateResponse",
                "diagnostics_export",
                "diagnostics_result",
                "mqttLastPackets",
                "mqttPacketCount",
                "openapiEventCount",
                "openapiLastEvents",
            ]);
        });

        it("should have diagnostics_export as button", () => {
            const device: ApplianceDevice = {
                sku: "H7131",
                deviceId: "11:22:33:44:55:66:77:88",
                name: "Heater",
                type: "devices.types.heater",
                capabilities: [],
                state: {},
                online: false,
                lastCloudStateResponse: "",
                rawMqttPackets: [],
                rawMqttPacketCount: 0,
                rawOpenapiEvents: [],
                rawOpenapiEventCount: 0,
            };

            const result = buildDeviceStateDefs(device);
            const diagBtn = result.find((s) => s.id === "diagnostics_export");
            expect(diagBtn).to.exist;
            expect(diagBtn!.role).to.equal("button");
            expect(diagBtn!.write).to.be.true;
            expect(diagBtn!.channel).to.equal("raw");
        });

        it("should route sensor properties to sensor channel", () => {
            const device: ApplianceDevice = {
                sku: "H5179",
                deviceId: "11:22:33:44:55:66:77:88",
                name: "Thermometer",
                type: "devices.types.thermometer",
                capabilities: [
                    {
                        type: "devices.capabilities.property",
                        instance: "sensorTemperature",
                        parameters: { dataType: "INTEGER", unit: "unit.celsius" },
                    },
                    {
                        type: "devices.capabilities.property",
                        instance: "sensorHumidity",
                        parameters: { dataType: "INTEGER", unit: "unit.percent" },
                    },
                ],
                state: {},
                online: true,
                lastCloudStateResponse: "",
                rawMqttPackets: [],
                rawMqttPacketCount: 0,
                rawOpenapiEvents: [],
                rawOpenapiEventCount: 0,
            };

            const result = buildDeviceStateDefs(device);
            const sensorStates = result.filter((s) => s.channel === "sensor");
            expect(sensorStates).to.have.lengthOf(2);
        });

        it("should route events to events channel", () => {
            const device: ApplianceDevice = {
                sku: "H7172",
                deviceId: "11:22:33:44:55:66:77:88",
                name: "Ice Maker",
                type: "devices.types.ice_maker",
                capabilities: [{
                    type: "devices.capabilities.event",
                    instance: "lackWaterEvent",
                    alarmType: 51,
                    parameters: { dataType: "ENUM" },
                }],
                state: {},
                online: true,
                lastCloudStateResponse: "",
                rawMqttPackets: [],
                rawMqttPacketCount: 0,
                rawOpenapiEvents: [],
                rawOpenapiEventCount: 0,
            };

            const result = buildDeviceStateDefs(device);
            const eventStates = result.filter((s) => s.channel === "events");
            expect(eventStates).to.have.lengthOf(1);
            expect(eventStates[0].id).to.equal("lack_water_event");
        });
    });
});
