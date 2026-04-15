import { expect } from "chai";
import { GoveeOpenapiMqttClient } from "../src/lib/govee-openapi-mqtt-client";
import { DeviceManager } from "../src/lib/device-manager";
import type { ApplianceDevice, OpenApiMqttEvent } from "../src/lib/types";

const mockLog: ioBroker.Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    level: "debug",
};

const mockTimers = {
    setInterval: () => undefined,
    clearInterval: () => {},
    setTimeout: () => undefined,
    clearTimeout: () => {},
};

function createTestDevice(overrides?: Partial<ApplianceDevice>): ApplianceDevice {
    return {
        sku: "H7172",
        deviceId: "9A:52:DE:AD:BE:EF:CA:FE",
        name: "Test Ice Maker",
        type: "devices.types.ice_maker",
        capabilities: [
            {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                parameters: { dataType: "ENUM", options: [{ name: "on", value: 1 }] },
            },
            {
                type: "devices.capabilities.event",
                instance: "lackWaterEvent",
                alarmType: 51,
                eventState: { options: [{ name: "lack", value: 1, message: "Lack of Water" }] },
                parameters: { dataType: "ENUM" },
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

describe("GoveeOpenapiMqttClient", () => {
    describe("constructor", () => {
        it("should create client with API key", () => {
            const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as any);
            expect(client).to.exist;
            expect(client.connected).to.be.false;
        });
    });

    describe("disconnect", () => {
        it("should handle disconnect when not connected", () => {
            const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as any);
            expect(() => client.disconnect()).to.not.throw();
        });

        it("should clear reconnect timer on disconnect", () => {
            const client = new GoveeOpenapiMqttClient("test-api-key", mockLog, mockTimers as any);
            client.disconnect();
            expect(client.connected).to.be.false;
        });
    });
});

describe("DeviceManager — handleOpenApiEvent", () => {
    it("should forward event capabilities to onDeviceUpdate", () => {
        const dm = new DeviceManager(mockLog);
        const device = createTestDevice();

        // Add device via cache
        dm.setSkuCache({
            loadAll: () => [
                {
                    sku: device.sku,
                    deviceId: device.deviceId,
                    name: device.name,
                    type: device.type,
                    capabilities: device.capabilities,
                    lastState: {},
                    cachedAt: Date.now(),
                },
            ],
            save: () => {},
            clear: () => {},
        } as any);
        dm.loadFromCache();

        let callbackCalled = false;
        let receivedCaps: any[] = [];

        dm.setOnDeviceUpdate((_dev, caps) => {
            callbackCalled = true;
            receivedCaps = caps;
        });

        const event: OpenApiMqttEvent = {
            sku: "H7172",
            device: "9A:52:DE:AD:BE:EF:CA:FE",
            capabilities: [
                {
                    type: "devices.capabilities.event",
                    instance: "lackWaterEvent",
                    state: { value: 1 },
                },
            ],
        };

        dm.handleOpenApiEvent(event);

        expect(callbackCalled).to.be.true;
        expect(receivedCaps).to.have.lengthOf(1);
        expect(receivedCaps[0].instance).to.equal("lackWaterEvent");
        expect(receivedCaps[0].state.value).to.equal(1);
    });

    it("should ignore events for unknown devices", () => {
        const dm = new DeviceManager(mockLog);
        let callbackCalled = false;

        dm.setOnDeviceUpdate(() => {
            callbackCalled = true;
        });

        const event: OpenApiMqttEvent = {
            sku: "H9999",
            device: "00:00:00:00:00:00:00:00",
            capabilities: [
                {
                    type: "devices.capabilities.event",
                    instance: "lackWaterEvent",
                    state: { value: 1 },
                },
            ],
        };

        dm.handleOpenApiEvent(event);

        expect(callbackCalled).to.be.false;
    });

    it("should not call callback for empty capabilities", () => {
        const dm = new DeviceManager(mockLog);
        const device = createTestDevice();

        dm.setSkuCache({
            loadAll: () => [
                {
                    sku: device.sku,
                    deviceId: device.deviceId,
                    name: device.name,
                    type: device.type,
                    capabilities: device.capabilities,
                    lastState: {},
                    cachedAt: Date.now(),
                },
            ],
            save: () => {},
            clear: () => {},
        } as any);
        dm.loadFromCache();

        let callbackCalled = false;
        dm.setOnDeviceUpdate(() => {
            callbackCalled = true;
        });

        const event: OpenApiMqttEvent = {
            sku: "H7172",
            device: "9A:52:DE:AD:BE:EF:CA:FE",
            capabilities: [],
        };

        dm.handleOpenApiEvent(event);

        expect(callbackCalled).to.be.false;
    });

    it("should handle multiple capabilities in one event", () => {
        const dm = new DeviceManager(mockLog);
        const device = createTestDevice();

        dm.setSkuCache({
            loadAll: () => [
                {
                    sku: device.sku,
                    deviceId: device.deviceId,
                    name: device.name,
                    type: device.type,
                    capabilities: device.capabilities,
                    lastState: {},
                    cachedAt: Date.now(),
                },
            ],
            save: () => {},
            clear: () => {},
        } as any);
        dm.loadFromCache();

        let receivedCaps: any[] = [];
        dm.setOnDeviceUpdate((_dev, caps) => {
            receivedCaps = caps;
        });

        const event: OpenApiMqttEvent = {
            sku: "H7172",
            device: "9A:52:DE:AD:BE:EF:CA:FE",
            capabilities: [
                {
                    type: "devices.capabilities.event",
                    instance: "lackWaterEvent",
                    state: { value: 1 },
                },
                {
                    type: "devices.capabilities.event",
                    instance: "iceFull",
                    state: { value: 1 },
                },
            ],
        };

        dm.handleOpenApiEvent(event);

        expect(receivedCaps).to.have.lengthOf(2);
        expect(receivedCaps[0].instance).to.equal("lackWaterEvent");
        expect(receivedCaps[1].instance).to.equal("iceFull");
    });

    it("should handle non-event capabilities from OpenAPI MQTT", () => {
        const dm = new DeviceManager(mockLog);
        const device = createTestDevice();

        dm.setSkuCache({
            loadAll: () => [
                {
                    sku: device.sku,
                    deviceId: device.deviceId,
                    name: device.name,
                    type: device.type,
                    capabilities: device.capabilities,
                    lastState: {},
                    cachedAt: Date.now(),
                },
            ],
            save: () => {},
            clear: () => {},
        } as any);
        dm.loadFromCache();

        let receivedCaps: any[] = [];
        dm.setOnDeviceUpdate((_dev, caps) => {
            receivedCaps = caps;
        });

        // OpenAPI MQTT might also send status capabilities
        const event: OpenApiMqttEvent = {
            sku: "H7172",
            device: "9A:52:DE:AD:BE:EF:CA:FE",
            capabilities: [
                {
                    type: "devices.capabilities.on_off",
                    instance: "powerSwitch",
                    state: { value: 1 },
                },
            ],
        };

        dm.handleOpenApiEvent(event);

        expect(receivedCaps).to.have.lengthOf(1);
        expect(receivedCaps[0].instance).to.equal("powerSwitch");
    });
});
