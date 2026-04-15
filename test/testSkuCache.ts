import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SkuCache, type CachedDeviceData } from "../src/lib/sku-cache";

const mockLog: ioBroker.Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    level: "debug",
};

function createTestData(
    sku = "H7131",
    deviceId = "AA:BB:CC:DD:EE:FF:00:11",
): CachedDeviceData {
    return {
        sku,
        deviceId,
        name: "Test Heater",
        type: "devices.types.heater",
        capabilities: [
            {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                parameters: { dataType: "ENUM", options: [{ name: "on", value: 1 }] },
            },
        ],
        lastState: { powerSwitch: 1 },
        cachedAt: Date.now(),
    };
}

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "sku-cache-test-"));
}

function cleanup(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

describe("SkuCache", () => {
    let dir: string;

    beforeEach(() => {
        dir = tmpDir();
    });

    afterEach(() => {
        cleanup(dir);
    });

    it("should create cache directory on construction", () => {
        new SkuCache(dir, mockLog);
        expect(fs.existsSync(path.join(dir, "cache"))).to.be.true;
    });

    it("should return empty for non-existent cache", () => {
        const cache = new SkuCache(dir, mockLog);
        expect(cache.loadAll()).to.deep.equal([]);
    });

    it("should save and load a cache entry", () => {
        const cache = new SkuCache(dir, mockLog);
        const data = createTestData();
        cache.save(data);
        const all = cache.loadAll();
        expect(all).to.have.length(1);
        expect(all[0].sku).to.equal("H7131");
        expect(all[0].name).to.equal("Test Heater");
        expect(all[0].type).to.equal("devices.types.heater");
        expect(all[0].lastState).to.deep.equal({ powerSwitch: 1 });
    });

    it("should overwrite existing cache entry", () => {
        const cache = new SkuCache(dir, mockLog);
        const data = createTestData();
        cache.save(data);
        data.name = "Updated Heater";
        data.lastState = { powerSwitch: 0, workMode: 2 };
        cache.save(data);
        const all = cache.loadAll();
        expect(all).to.have.length(1);
        expect(all[0].name).to.equal("Updated Heater");
        expect(all[0].lastState).to.deep.equal({ powerSwitch: 0, workMode: 2 });
    });

    it("should store separate entries for different devices", () => {
        const cache = new SkuCache(dir, mockLog);
        cache.save(createTestData("H7131", "AA:BB:CC:DD:11:22:33:44"));
        cache.save(createTestData("H7172", "EE:FF:00:11:22:33:44:55"));
        const all = cache.loadAll();
        expect(all).to.have.length(2);
        const skus = all.map((d) => d.sku).sort();
        expect(skus).to.deep.equal(["H7131", "H7172"]);
    });

    it("should store separate entries for same SKU different devices", () => {
        const cache = new SkuCache(dir, mockLog);
        cache.save(createTestData("H7131", "AA:BB:CC:DD:11:22:11:11"));
        cache.save(createTestData("H7131", "AA:BB:CC:DD:11:22:22:22"));
        const all = cache.loadAll();
        expect(all).to.have.length(2);
    });

    it("should clear all cache entries", () => {
        const cache = new SkuCache(dir, mockLog);
        cache.save(createTestData("H7131", "AA:BB:CC:DD:11:22:33:44"));
        cache.save(createTestData("H7172", "EE:FF:00:11:22:33:44:55"));
        expect(cache.loadAll()).to.have.length(2);
        cache.clear();
        expect(cache.loadAll()).to.have.length(0);
    });

    it("should handle corrupt JSON gracefully", () => {
        const cache = new SkuCache(dir, mockLog);
        const cacheDir = path.join(dir, "cache");
        fs.writeFileSync(path.join(cacheDir, "corrupt_1234.json"), "not json");
        expect(cache.loadAll()).to.deep.equal([]);
    });

    it("should use normalized device ID for file naming", () => {
        const cache = new SkuCache(dir, mockLog);
        cache.save(createTestData("H7131", "AA:BB:CC:DD:11:22:33:44"));
        const all = cache.loadAll();
        expect(all).to.have.length(1);
        expect(all[0].sku).to.equal("H7131");
    });

    it("should preserve capabilities in cache", () => {
        const cache = new SkuCache(dir, mockLog);
        const data = createTestData();
        data.capabilities = [
            {
                type: "devices.capabilities.on_off",
                instance: "powerSwitch",
                parameters: { dataType: "ENUM", options: [{ name: "on", value: 1 }, { name: "off", value: 0 }] },
            },
            {
                type: "devices.capabilities.work_mode",
                instance: "workMode",
                parameters: {
                    dataType: "STRUCT",
                    fields: [
                        { fieldName: "workMode", dataType: "ENUM", options: [{ name: "Heat", value: 1 }] },
                    ],
                },
            },
        ];
        cache.save(data);
        const loaded = cache.loadAll()[0];
        expect(loaded.capabilities).to.have.length(2);
        expect(loaded.capabilities[1].instance).to.equal("workMode");
    });
});
