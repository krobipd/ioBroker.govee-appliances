import { expect } from "chai";
import { DeviceManager } from "../src/lib/device-manager";
import type { ApplianceDevice, CloudDevice } from "../src/lib/types";

const mockLog: ioBroker.Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    level: "debug",
};

function createTestDevice(overrides?: Partial<ApplianceDevice>): ApplianceDevice {
    return {
        sku: "H7131",
        deviceId: "AA:BB:CC:DD:EE:FF:AB:3F",
        name: "Test Heater",
        type: "devices.types.heater",
        capabilities: [
            {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                parameters: { dataType: "ENUM", options: [{ name: "on", value: 1 }] },
            },
        ],
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

describe("DeviceManager", () => {
    describe("getAllDevices / getDevice", () => {
        it("should return empty list initially", () => {
            const dm = new DeviceManager(mockLog);
            expect(dm.getAllDevices()).to.have.lengthOf(0);
        });

        it("should return device after loadFromCache", () => {
            const dm = new DeviceManager(mockLog);
            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:EE:FF:AB:3F",
                        name: "Cached Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: { powerSwitch: 1 },
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
                clear: () => {},
            } as any);

            dm.loadFromCache();

            expect(dm.getAllDevices()).to.have.lengthOf(1);
            const device = dm.getDevice("AA:BB:CC:DD:EE:FF:AB:3F");
            expect(device).to.exist;
            expect(device!.name).to.equal("Cached Heater");
            expect(device!.state).to.deep.equal({ powerSwitch: 1 });
        });

        it("should return undefined for unknown device", () => {
            const dm = new DeviceManager(mockLog);
            expect(dm.getDevice("00:00:00:00:00:00:00:00")).to.be.undefined;
        });
    });

    describe("loadFromCache", () => {
        it("should not add duplicate devices", () => {
            const dm = new DeviceManager(mockLog);
            const cacheData = {
                sku: "H7131",
                deviceId: "AA:BB:CC:DD:EE:FF:AB:3F",
                name: "Heater",
                type: "devices.types.heater",
                capabilities: [],
                lastState: {},
                cachedAt: Date.now(),
            };

            dm.setSkuCache({
                loadAll: () => [cacheData, cacheData],
                save: () => {},
                clear: () => {},
            } as any);

            dm.loadFromCache();
            expect(dm.getAllDevices()).to.have.lengthOf(1);
        });

        it("should do nothing without cache", () => {
            const dm = new DeviceManager(mockLog);
            dm.loadFromCache();
            expect(dm.getAllDevices()).to.have.lengthOf(0);
        });

        it("should set cached devices as offline", () => {
            const dm = new DeviceManager(mockLog);
            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:EE:FF:AB:3F",
                        name: "Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
                clear: () => {},
            } as any);

            dm.loadFromCache();
            expect(dm.getDevice("AA:BB:CC:DD:EE:FF:AB:3F")!.online).to.be.false;
        });
    });

    describe("loadFromCloud", () => {
        it("should filter out light devices", async () => {
            const dm = new DeviceManager(mockLog);

            const cloudDevices: CloudDevice[] = [
                {
                    sku: "H7131",
                    device: "AA:BB:CC:DD:11:22:33:44",
                    deviceName: "Heater",
                    type: "devices.types.heater",
                    capabilities: [],
                },
                {
                    sku: "H6199",
                    device: "EE:FF:00:11:22:33:44:55",
                    deviceName: "LED Strip",
                    type: "devices.types.light",
                    capabilities: [],
                },
            ];

            dm.setCloudClient({
                getDevices: async () => cloudDevices,
            } as any);

            dm.setSkuCache({
                loadAll: () => [],
                save: () => {},
                clear: () => {},
            } as any);

            await dm.loadFromCloud();

            expect(dm.getAllDevices()).to.have.lengthOf(1);
            expect(dm.getAllDevices()[0].sku).to.equal("H7131");
        });

        // Regression: Cloud API drift — malformed device entries must not crash or be loaded.
        it("should skip cloud devices with missing or non-string device ID", async () => {
            const dm = new DeviceManager(mockLog);
            const cloudDevices = [
                {
                    sku: "H7131",
                    device: "AA:BB:CC:DD:11:22:33:44",
                    deviceName: "Valid",
                    type: "devices.types.heater",
                    capabilities: [],
                },
                {
                    sku: "H7131",
                    // device field missing entirely — previously crashed normalizeDeviceId
                    deviceName: "Broken 1",
                    type: "devices.types.heater",
                    capabilities: [],
                },
                {
                    sku: "H7131",
                    device: 12345, // non-string
                    deviceName: "Broken 2",
                    type: "devices.types.heater",
                    capabilities: [],
                },
            ] as unknown as CloudDevice[];

            dm.setCloudClient({
                getDevices: async () => cloudDevices,
            } as any);
            dm.setSkuCache({
                loadAll: () => [],
                save: () => {},
                clear: () => {},
            } as any);

            await dm.loadFromCloud();

            expect(dm.getAllDevices()).to.have.lengthOf(1);
            expect(dm.getAllDevices()[0].name).to.equal("Valid");
        });

        it("should skip cloud devices with missing or non-string type", async () => {
            const dm = new DeviceManager(mockLog);
            const cloudDevices = [
                { sku: "H7131", device: "AA:BB:CC:DD:11:22:33:44", deviceName: "X1", capabilities: [] },
                { sku: "H7131", device: "AA:BB:CC:DD:11:22:33:45", deviceName: "X2", type: 123, capabilities: [] },
            ] as unknown as CloudDevice[];

            dm.setCloudClient({
                getDevices: async () => cloudDevices,
            } as any);
            dm.setSkuCache({
                loadAll: () => [],
                save: () => {},
                clear: () => {},
            } as any);

            await dm.loadFromCloud();
            expect(dm.getAllDevices()).to.have.lengthOf(0);
        });

        it("should update existing device from Cloud", async () => {
            const dm = new DeviceManager(mockLog);

            // Pre-load from cache
            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:11:22:33:44",
                        name: "Old Name",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
                clear: () => {},
            } as any);
            dm.loadFromCache();

            dm.setCloudClient({
                getDevices: async () => [
                    {
                        sku: "H7131",
                        device: "AA:BB:CC:DD:11:22:33:44",
                        deviceName: "New Name",
                        type: "devices.types.heater",
                        capabilities: [
                            {
                                type: "devices.capabilities.on_off",
                                instance: "powerSwitch",
                                parameters: { dataType: "ENUM" },
                            },
                        ],
                    },
                ],
            } as any);

            await dm.loadFromCloud();

            const device = dm.getDevice("AA:BB:CC:DD:11:22:33:44");
            expect(device!.name).to.equal("New Name");
            expect(device!.capabilities).to.have.lengthOf(1);
        });

        it("should call onDeviceListChanged callback", async () => {
            const dm = new DeviceManager(mockLog);
            let callbackDevices: ApplianceDevice[] = [];

            dm.setOnDeviceListChanged((devices) => {
                callbackDevices = devices;
            });

            dm.setCloudClient({
                getDevices: async () => [
                    {
                        sku: "H7131",
                        device: "AA:BB:CC:DD:11:22:33:44",
                        deviceName: "Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                    },
                ],
            } as any);

            dm.setSkuCache({
                loadAll: () => [],
                save: () => {},
                clear: () => {},
            } as any);

            await dm.loadFromCloud();
            expect(callbackDevices).to.have.lengthOf(1);
        });

        it("should handle Cloud API errors gracefully", async () => {
            const warnings: string[] = [];
            const dm = new DeviceManager({
                ...mockLog,
                warn: (msg: string) => { warnings.push(msg); },
            });

            dm.setCloudClient({
                getDevices: async () => { throw new Error("HTTP 500 Internal Server Error"); },
            } as any);

            await dm.loadFromCloud();
            expect(dm.getAllDevices()).to.have.lengthOf(0);
            expect(warnings).to.have.lengthOf(1);
            expect(warnings[0]).to.include("500");
        });

        it("should dedup repeated Cloud errors", async () => {
            const warnings: string[] = [];
            const dm = new DeviceManager({
                ...mockLog,
                warn: (msg: string) => { warnings.push(msg); },
            });

            dm.setCloudClient({
                getDevices: async () => { throw new Error("connect ECONNREFUSED 1.2.3.4:443"); },
            } as any);

            await dm.loadFromCloud();
            await dm.loadFromCloud();

            // First call → warn, second call (same category NETWORK) → debug only
            expect(warnings).to.have.lengthOf(1);
        });

        it("should do nothing without cloudClient", async () => {
            const dm = new DeviceManager(mockLog);
            await dm.loadFromCloud();
            expect(dm.getAllDevices()).to.have.lengthOf(0);
        });
    });

    describe("handleMqttStatus", () => {
        it("should merge state into device.state for known device", () => {
            const dm = new DeviceManager(mockLog);

            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:11:22:33:44",
                        name: "Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
            } as any);
            dm.loadFromCache();

            dm.handleMqttStatus({
                sku: "H7131",
                device: "AA:BB:CC:DD:11:22:33:44",
                state: { powerSwitch: 1, targetTemperature: 72 },
            });

            const device = dm.getDevice("AA:BB:CC:DD:11:22:33:44");
            expect(device!.state.powerSwitch).to.equal(1);
            expect(device!.state.targetTemperature).to.equal(72);
        });

        it("should ignore unknown device without throwing", () => {
            const dm = new DeviceManager(mockLog);

            dm.handleMqttStatus({
                sku: "H9999",
                device: "00:00:00:00:00:00:00:00",
                state: { power: 1 },
            });
            // No exception expected
        });
    });

    describe("handleRawPackets", () => {
        it("should add packets to ring buffer", () => {
            const dm = new DeviceManager(mockLog);

            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:11:22:33:44",
                        name: "Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
                clear: () => {},
            } as any);
            dm.loadFromCache();

            dm.handleRawPackets("AA:BB:CC:DD:11:22:33:44", ["aa0501", "aa0502"]);

            const device = dm.getDevice("AA:BB:CC:DD:11:22:33:44");
            expect(device!.rawMqttPackets).to.have.lengthOf(1);
            expect(device!.rawMqttPackets[0].packets).to.deep.equal(["aa0501", "aa0502"]);
            expect(device!.rawMqttPacketCount).to.equal(2);
        });

        it("should enforce ring buffer limit of 50", () => {
            const dm = new DeviceManager(mockLog);

            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:11:22:33:44",
                        name: "Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
                clear: () => {},
            } as any);
            dm.loadFromCache();

            // Add 55 entries
            for (let i = 0; i < 55; i++) {
                dm.handleRawPackets("AA:BB:CC:DD:11:22:33:44", [`pkt_${i}`]);
            }

            const device = dm.getDevice("AA:BB:CC:DD:11:22:33:44");
            expect(device!.rawMqttPackets).to.have.lengthOf(50);
            expect(device!.rawMqttPacketCount).to.equal(55);
            // Oldest entries should be dropped
            expect(device!.rawMqttPackets[0].packets[0]).to.equal("pkt_5");
        });

        it("should ignore packets for unknown device", () => {
            const dm = new DeviceManager(mockLog);
            // No exception expected
            dm.handleRawPackets("00:00:00:00:00:00:00:00", ["aa05"]);
        });
    });

    describe("generateDiagnostics", () => {
        it("should return valid JSON with all fields", () => {
            const dm = new DeviceManager(mockLog);
            const device = createTestDevice();
            device.state = { powerSwitch: 1, workMode: 2 };
            device.rawMqttPacketCount = 42;
            device.rawOpenapiEventCount = 5;

            const json = dm.generateDiagnostics(device);
            const parsed = JSON.parse(json);

            expect(parsed.sku).to.equal("H7131");
            expect(parsed.deviceId).to.equal("AA:BB:CC:DD:EE:FF:AB:3F");
            expect(parsed.name).to.equal("Test Heater");
            expect(parsed.type).to.equal("devices.types.heater");
            expect(parsed.online).to.be.true;
            expect(parsed.capabilities).to.have.lengthOf(1);
            expect(parsed.currentState).to.deep.equal({ powerSwitch: 1, workMode: 2 });
            expect(parsed.iotMqtt.packetCount).to.equal(42);
            expect(parsed.iotMqtt.lastPackets).to.be.an("array");
            expect(parsed.openapiMqtt.eventCount).to.equal(5);
            expect(parsed.openapiMqtt.lastEvents).to.be.an("array");
            expect(parsed.timestamp).to.be.a("string");
        });

        it("should include last 10 MQTT packets", () => {
            const dm = new DeviceManager(mockLog);
            const device = createTestDevice();

            // Add 15 packets to ring buffer
            for (let i = 0; i < 15; i++) {
                device.rawMqttPackets.push({ timestamp: 1000 + i, packets: [`pkt_${i}`] });
            }

            const parsed = JSON.parse(dm.generateDiagnostics(device));
            expect(parsed.iotMqtt.lastPackets).to.have.lengthOf(10);
            expect(parsed.iotMqtt.lastPackets[0].packets[0]).to.equal("pkt_5");
        });
    });

    describe("sendCommand", () => {
        it("should send command via Cloud API with rate limiter", async () => {
            const dm = new DeviceManager(mockLog);
            let controlArgs: any[] = [];

            dm.setCloudClient({
                controlDevice: async (...args: any[]) => {
                    controlArgs = args;
                },
            } as any);

            dm.setRateLimiter({
                tryExecute: async (fn: () => Promise<void>) => {
                    await fn();
                    return true;
                },
            } as any);

            const device = createTestDevice();
            await dm.sendCommand(device, "devices.capabilities.on_off", "powerSwitch", 1);

            expect(controlArgs).to.deep.equal([
                "H7131",
                "AA:BB:CC:DD:EE:FF:AB:3F",
                "devices.capabilities.on_off",
                "powerSwitch",
                1,
            ]);
        });

        it("should warn when Cloud API not initialized", async () => {
            const warnings: string[] = [];
            const dm = new DeviceManager({
                ...mockLog,
                warn: (msg: string) => { warnings.push(msg); },
            });

            const device = createTestDevice();
            await dm.sendCommand(device, "type", "instance", 1);

            expect(warnings).to.have.lengthOf(1);
            expect(warnings[0]).to.include("not initialized");
        });

        it("should handle rate-limited command gracefully", async () => {
            const dm = new DeviceManager(mockLog);
            let controlCalled = false;

            dm.setCloudClient({
                controlDevice: async () => { controlCalled = true; },
            } as any);

            dm.setRateLimiter({
                tryExecute: async () => false,
            } as any);

            const device = createTestDevice();
            await dm.sendCommand(device, "type", "instance", 1);

            expect(controlCalled).to.be.false;
        });
    });

    describe("pollDeviceStates", () => {
        it("should poll each device via rate limiter", async () => {
            const dm = new DeviceManager(mockLog);
            const polledSkus: string[] = [];

            dm.setSkuCache({
                loadAll: () => [
                    {
                        sku: "H7131",
                        deviceId: "AA:BB:CC:DD:11:22:33:44",
                        name: "Heater",
                        type: "devices.types.heater",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                    {
                        sku: "H7172",
                        deviceId: "EE:FF:00:11:22:33:44:55",
                        name: "Ice Maker",
                        type: "devices.types.ice_maker",
                        capabilities: [],
                        lastState: {},
                        cachedAt: Date.now(),
                    },
                ],
                save: () => {},
                clear: () => {},
            } as any);
            dm.loadFromCache();

            dm.setCloudClient({
                getDeviceState: async (sku: string) => {
                    polledSkus.push(sku);
                    return [];
                },
            } as any);

            dm.setRateLimiter({
                tryExecute: async (fn: () => Promise<void>) => {
                    await fn();
                    return true;
                },
            } as any);

            await dm.pollDeviceStates();
            expect(polledSkus).to.have.lengthOf(2);
            expect(polledSkus.sort()).to.deep.equal(["H7131", "H7172"]);
        });

        it("should do nothing without cloudClient or rateLimiter", async () => {
            const dm = new DeviceManager(mockLog);
            await dm.pollDeviceStates();
            // No error expected
        });
    });
});
