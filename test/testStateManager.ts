import { expect } from "chai";
import { StateManager } from "../src/lib/state-manager";
import type { StateDefinition } from "../src/lib/capability-mapper";
import type { ApplianceDevice } from "../src/lib/types";

/** Recorded adapter call for assertions */
interface AdapterCall {
    method: string;
    args: unknown[];
}

/** Minimal mock adapter with call tracking */
function createMockAdapter(): {
    adapter: any;
    calls: AdapterCall[];
    objects: Map<string, any>;
    states: Map<string, any>;
} {
    const calls: AdapterCall[] = [];
    const objects = new Map<string, any>();
    const states = new Map<string, any>();

    const adapter = {
        namespace: "govee-appliances.0",
        log: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            silly: () => {},
            level: "debug",
        },
        extendObjectAsync: async (id: string, obj: any) => {
            calls.push({ method: "extendObjectAsync", args: [id, obj] });
            objects.set(id, obj);
        },
        setStateAsync: async (id: string, state: any) => {
            calls.push({ method: "setStateAsync", args: [id, state] });
            states.set(id, state);
        },
        getStateAsync: async (id: string) => {
            calls.push({ method: "getStateAsync", args: [id] });
            return states.get(id) ?? null;
        },
        getObjectAsync: async (id: string) => {
            calls.push({ method: "getObjectAsync", args: [id] });
            return objects.get(id) ?? null;
        },
        delObjectAsync: async (id: string, _opts?: any) => {
            calls.push({ method: "delObjectAsync", args: [id] });
            objects.delete(id);
        },
        delStateAsync: async (id: string) => {
            calls.push({ method: "delStateAsync", args: [id] });
            states.delete(id);
        },
        getObjectViewAsync: async (_design: string, _type: string, opts: any) => {
            calls.push({ method: "getObjectViewAsync", args: [_design, _type, opts] });
            const rows: any[] = [];
            const prefix = opts.startkey.replace("govee-appliances.0.", "");
            for (const [key] of objects) {
                if (key.startsWith(prefix)) {
                    rows.push({ id: `govee-appliances.0.${key}`, value: objects.get(key) });
                }
            }
            return { rows };
        },
    };

    return { adapter, calls, objects, states };
}

function createTestDevice(overrides?: Partial<ApplianceDevice>): ApplianceDevice {
    return {
        sku: "H7131",
        deviceId: "AA:BB:CC:DD:EE:FF:AB:3F",
        name: "Test Heater",
        type: "devices.types.heater",
        capabilities: [],
        state: {},
        online: true,
        lastCloudStateResponse: "",
        rawMqttPackets: [],
        rawMqttPacketCount: 0,
        rawOpenapiEvents: [],
        rawOpenapiEventCount: 0,
        ...overrides,
    };
}

describe("StateManager", () => {
    describe("devicePrefix", () => {
        it("should build devices.sku_shortid prefix", () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();
            expect(sm.devicePrefix(device)).to.equal("devices.h7131_ab3f");
        });
    });

    describe("createDeviceStates", () => {
        it("should create device, info channel, and info states", async () => {
            const { adapter, calls } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            await sm.createDeviceStates(device, []);

            // Device object
            const deviceCall = calls.find(
                (c) => c.method === "extendObjectAsync" && c.args[0] === "devices.h7131_ab3f",
            );
            expect(deviceCall).to.exist;
            expect((deviceCall!.args[1] as any).type).to.equal("device");
            expect((deviceCall!.args[1] as any).native.sku).to.equal("H7131");

            // Info channel
            const infoChannel = calls.find(
                (c) => c.method === "extendObjectAsync" && c.args[0] === "devices.h7131_ab3f.info",
            );
            expect(infoChannel).to.exist;
            expect((infoChannel!.args[1] as any).type).to.equal("channel");

            // Info states: name, model, online
            const nameState = calls.find(
                (c) => c.method === "extendObjectAsync" && c.args[0] === "devices.h7131_ab3f.info.name",
            );
            expect(nameState).to.exist;

            const modelState = calls.find(
                (c) => c.method === "extendObjectAsync" && c.args[0] === "devices.h7131_ab3f.info.model",
            );
            expect(modelState).to.exist;

            const onlineState = calls.find(
                (c) => c.method === "extendObjectAsync" && c.args[0] === "devices.h7131_ab3f.info.online",
            );
            expect(onlineState).to.exist;
        });

        it("should set info state values", async () => {
            const { adapter, states } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            await sm.createDeviceStates(device, []);

            expect(states.get("devices.h7131_ab3f.info.name")).to.deep.include({ val: "Test Heater", ack: true });
            expect(states.get("devices.h7131_ab3f.info.model")).to.deep.include({ val: "H7131", ack: true });
            expect(states.get("devices.h7131_ab3f.info.online")).to.deep.include({ val: true, ack: true });
        });

        it("should create channel and state objects for stateDefs", async () => {
            const { adapter, objects } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "power",
                    name: "Power",
                    type: "boolean",
                    role: "switch",
                    write: true,
                    def: false,
                    capabilityType: "devices.capabilities.on_off",
                    capabilityInstance: "powerSwitch",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            // Control channel created
            expect(objects.has("devices.h7131_ab3f.control")).to.be.true;
            expect(objects.get("devices.h7131_ab3f.control").type).to.equal("channel");
            expect(objects.get("devices.h7131_ab3f.control").common.name).to.equal("Controls");

            // Power state created
            expect(objects.has("devices.h7131_ab3f.control.power")).to.be.true;
            const powerObj = objects.get("devices.h7131_ab3f.control.power");
            expect(powerObj.common.type).to.equal("boolean");
            expect(powerObj.common.role).to.equal("switch");
            expect(powerObj.common.write).to.be.true;
            expect(powerObj.native.capabilityType).to.equal("devices.capabilities.on_off");
        });

        it("should route sensor states to sensor channel", async () => {
            const { adapter, objects } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "sensor_temperature",
                    name: "Temperature",
                    type: "number",
                    role: "value.temperature",
                    write: false,
                    unit: "°C",
                    channel: "sensor",
                    capabilityType: "devices.capabilities.property",
                    capabilityInstance: "sensorTemperature",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            expect(objects.has("devices.h7131_ab3f.sensor")).to.be.true;
            expect(objects.get("devices.h7131_ab3f.sensor").common.name).to.equal("Sensors");
            expect(objects.has("devices.h7131_ab3f.sensor.sensor_temperature")).to.be.true;
            expect(objects.get("devices.h7131_ab3f.sensor.sensor_temperature").common.unit).to.equal("°C");
        });

        it("should route events to events channel", async () => {
            const { adapter, objects } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "lack_water_event",
                    name: "Lack Water",
                    type: "boolean",
                    role: "indicator.alarm",
                    write: false,
                    def: false,
                    channel: "events",
                    capabilityType: "devices.capabilities.event",
                    capabilityInstance: "lackWaterEvent",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            expect(objects.has("devices.h7131_ab3f.events")).to.be.true;
            expect(objects.get("devices.h7131_ab3f.events").common.name).to.equal("Events");
            expect(objects.has("devices.h7131_ab3f.events.lack_water_event")).to.be.true;
        });

        it("should route raw states to raw channel", async () => {
            const { adapter, objects } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "diagnostics_export",
                    name: "Export Diagnostics",
                    type: "boolean",
                    role: "button",
                    write: true,
                    def: false,
                    channel: "raw",
                    capabilityType: "",
                    capabilityInstance: "",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            expect(objects.has("devices.h7131_ab3f.raw")).to.be.true;
            expect(objects.get("devices.h7131_ab3f.raw").common.name).to.equal("Raw Data & Diagnostics");
        });

        it("should set default value for state with def", async () => {
            const { adapter, states } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "power",
                    name: "Power",
                    type: "boolean",
                    role: "switch",
                    write: true,
                    def: false,
                    capabilityType: "devices.capabilities.on_off",
                    capabilityInstance: "powerSwitch",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            expect(states.has("devices.h7131_ab3f.control.power")).to.be.true;
            expect(states.get("devices.h7131_ab3f.control.power")).to.deep.include({ val: false, ack: true });
        });

        it("should include min/max/states properties", async () => {
            const { adapter, objects } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "work_mode",
                    name: "Work Mode",
                    type: "number",
                    role: "level.mode",
                    write: true,
                    min: 1,
                    max: 3,
                    states: { "1": "Heat", "2": "Cool", "3": "Auto" },
                    def: 1,
                    capabilityType: "devices.capabilities.work_mode",
                    capabilityInstance: "workMode",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            const obj = objects.get("devices.h7131_ab3f.control.work_mode");
            expect(obj.common.min).to.equal(1);
            expect(obj.common.max).to.equal(3);
            expect(obj.common.states).to.deep.equal({ "1": "Heat", "2": "Cool", "3": "Auto" });
        });

        it("should create multiple channels for mixed state types", async () => {
            const { adapter, objects } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "power", name: "Power", type: "boolean", role: "switch",
                    write: true, def: false, capabilityType: "t", capabilityInstance: "i",
                },
                {
                    id: "sensor_temperature", name: "Temperature", type: "number",
                    role: "value.temperature", write: false, channel: "sensor",
                    capabilityType: "t", capabilityInstance: "i",
                },
                {
                    id: "lack_water", name: "Lack Water", type: "boolean",
                    role: "indicator.alarm", write: false, channel: "events",
                    capabilityType: "t", capabilityInstance: "i",
                },
                {
                    id: "mqttPacketCount", name: "MQTT Packet Count", type: "number",
                    role: "value", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            expect(objects.has("devices.h7131_ab3f.control")).to.be.true;
            expect(objects.has("devices.h7131_ab3f.sensor")).to.be.true;
            expect(objects.has("devices.h7131_ab3f.events")).to.be.true;
            expect(objects.has("devices.h7131_ab3f.raw")).to.be.true;
        });
    });

    describe("resolveStatePath", () => {
        it("should resolve control state after creation", async () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "power", name: "Power", type: "boolean", role: "switch",
                    write: true, capabilityType: "t", capabilityInstance: "i",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            const path = sm.resolveStatePath("devices.h7131_ab3f", "power");
            expect(path).to.equal("devices.h7131_ab3f.control.power");
        });

        it("should resolve sensor state", async () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "sensor_temperature", name: "Temperature", type: "number",
                    role: "value.temperature", write: false, channel: "sensor",
                    capabilityType: "t", capabilityInstance: "i",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            const path = sm.resolveStatePath("devices.h7131_ab3f", "sensor_temperature");
            expect(path).to.equal("devices.h7131_ab3f.sensor.sensor_temperature");
        });

        it("should resolve events state", async () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "lack_water", name: "Lack Water", type: "boolean",
                    role: "indicator.alarm", write: false, channel: "events",
                    capabilityType: "t", capabilityInstance: "i",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            const path = sm.resolveStatePath("devices.h7131_ab3f", "lack_water");
            expect(path).to.equal("devices.h7131_ab3f.events.lack_water");
        });

        it("should resolve raw state", async () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "mqttLastPackets", name: "MQTT Packets", type: "string",
                    role: "json", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
            ];

            await sm.createDeviceStates(device, stateDefs);

            const path = sm.resolveStatePath("devices.h7131_ab3f", "mqttLastPackets");
            expect(path).to.equal("devices.h7131_ab3f.raw.mqttLastPackets");
        });

        it("should default unknown states to control channel", () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);

            const path = sm.resolveStatePath("devices.h7131_ab3f", "unknown_state");
            expect(path).to.equal("devices.h7131_ab3f.control.unknown_state");
        });
    });

    describe("updateDeviceStates", () => {
        it("should update state values via setStateIfExists", async () => {
            const { adapter, states } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            // Pre-create objects and register channel mappings
            const stateDefs: StateDefinition[] = [
                {
                    id: "power", name: "Power", type: "boolean", role: "switch",
                    write: true, def: false, capabilityType: "t", capabilityInstance: "i",
                },
            ];
            await sm.createDeviceStates(device, stateDefs);

            await sm.updateDeviceStates(device, [
                { stateId: "power", value: true },
            ]);

            expect(states.get("devices.h7131_ab3f.control.power")).to.deep.include({ val: true, ack: true });
        });

        it("should route online state to info.online", async () => {
            const { adapter, states } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            await sm.createDeviceStates(device, []);

            await sm.updateDeviceStates(device, [
                { stateId: "online", value: true },
            ]);

            expect(states.get("devices.h7131_ab3f.info.online")).to.deep.include({ val: true, ack: true });
        });

        it("should skip update for non-existent object", async () => {
            const { adapter, calls } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            // No states created, so resolveStatePath defaults to control
            await sm.updateDeviceStates(device, [
                { stateId: "nonexistent", value: 42 },
            ]);

            // getObjectAsync returns null for unknown → no setStateAsync
            const setStateCalls = calls.filter(
                (c) => c.method === "setStateAsync" && (c.args[0] as string).includes("nonexistent"),
            );
            expect(setStateCalls).to.have.lengthOf(0);
        });
    });

    describe("updateRawMqttData", () => {
        it("should update MQTT packet states", async () => {
            const { adapter, states } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            // Create raw states so objects exist
            const stateDefs: StateDefinition[] = [
                {
                    id: "mqttLastPackets", name: "MQTT Packets", type: "string",
                    role: "json", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
                {
                    id: "mqttPacketCount", name: "MQTT Packet Count", type: "number",
                    role: "value", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
            ];
            await sm.createDeviceStates(device, stateDefs);

            device.rawMqttPackets = [{ timestamp: 1000, packets: ["aa05"] }];
            device.rawMqttPacketCount = 1;

            await sm.updateRawMqttData(device);

            const packetsState = states.get("devices.h7131_ab3f.raw.mqttLastPackets");
            expect(packetsState).to.exist;
            expect(packetsState.val).to.equal(JSON.stringify([{ timestamp: 1000, packets: ["aa05"] }]));

            const countState = states.get("devices.h7131_ab3f.raw.mqttPacketCount");
            expect(countState).to.exist;
            expect(countState.val).to.equal(1);
        });
    });

    describe("updateRawApiData", () => {
        it("should update API capability and state response states", async () => {
            const { adapter, states } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "apiCapabilities", name: "API Capabilities", type: "string",
                    role: "json", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
                {
                    id: "apiLastStateResponse", name: "Last State Response", type: "string",
                    role: "json", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
            ];
            await sm.createDeviceStates(device, stateDefs);

            await sm.updateRawApiData(device, '{"caps": []}', '{"state": {}}');

            expect(states.get("devices.h7131_ab3f.raw.apiCapabilities").val).to.equal('{"caps": []}');
            expect(states.get("devices.h7131_ab3f.raw.apiLastStateResponse").val).to.equal('{"state": {}}');
        });

        it("should skip stateResponse when undefined", async () => {
            const { adapter, calls } = createMockAdapter();
            const sm = new StateManager(adapter);
            const device = createTestDevice();

            const stateDefs: StateDefinition[] = [
                {
                    id: "apiCapabilities", name: "API Capabilities", type: "string",
                    role: "json", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
                {
                    id: "apiLastStateResponse", name: "Last State Response", type: "string",
                    role: "json", write: false, channel: "raw",
                    capabilityType: "", capabilityInstance: "",
                },
            ];
            await sm.createDeviceStates(device, stateDefs);

            // Clear previous setStateAsync calls from createDeviceStates
            const callsBefore = calls.filter((c) => c.method === "setStateAsync").length;

            await sm.updateRawApiData(device, '{"caps": []}');

            // Only apiCapabilities should be set, not apiLastStateResponse
            const setStateCalls = calls.filter((c) => c.method === "setStateAsync").slice(callsBefore);
            const apiCapCall = setStateCalls.find((c) => (c.args[0] as string).includes("apiCapabilities"));
            const apiStateCall = setStateCalls.find((c) => (c.args[0] as string).includes("apiLastStateResponse"));
            expect(apiCapCall).to.exist;
            expect(apiStateCall).to.not.exist;
        });
    });

    describe("cleanupDevices", () => {
        it("should delete devices not in current list", async () => {
            const { adapter, objects, calls } = createMockAdapter();
            const sm = new StateManager(adapter);

            // Simulate an existing device object in the adapter
            objects.set("devices.h9999_dead", { type: "device", common: { name: "Old Device" } });

            const currentDevices = [createTestDevice()];
            await sm.cleanupDevices(currentDevices);

            const delCalls = calls.filter(
                (c) => c.method === "delObjectAsync" && (c.args[0] as string).includes("h9999_dead"),
            );
            expect(delCalls).to.have.lengthOf(1);
        });

        it("should keep devices that still exist", async () => {
            const { adapter, objects, calls } = createMockAdapter();
            const sm = new StateManager(adapter);

            objects.set("devices.h7131_ab3f", { type: "device", common: { name: "Heater" } });

            const currentDevices = [createTestDevice()];
            await sm.cleanupDevices(currentDevices);

            const delCalls = calls.filter(
                (c) => c.method === "delObjectAsync" && (c.args[0] as string).includes("h7131_ab3f"),
            );
            expect(delCalls).to.have.lengthOf(0);
        });

        it("should handle empty object list gracefully", async () => {
            const { adapter } = createMockAdapter();
            const sm = new StateManager(adapter);

            // No objects exist — should not throw
            await sm.cleanupDevices([]);
        });
    });
});
