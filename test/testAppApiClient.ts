import { expect } from "chai";
import {
    parseLastData,
    parseSettings,
    type AppDeviceEntry,
} from "../src/lib/govee-app-api-client";
import { buildCapabilitiesFromAppEntry } from "../src/lib/device-manager";

describe("AppApiClient — lastDeviceData parser", () => {
    it("parses the full H5179 payload captured from /device/rest/devices/v1/list", () => {
        const raw = '{"online":true,"tem":2370,"hum":4290,"lastTime":1776704461000}';
        const out = parseLastData(raw);
        expect(out).to.deep.equal({
            online: true,
            tem: 2370,
            hum: 4290,
            lastTime: 1776704461000,
        });
    });

    it("accepts numeric online=1/0 (older firmware variants)", () => {
        expect(parseLastData('{"online":1,"tem":100}')).to.deep.include({
            online: true,
        });
        expect(parseLastData('{"online":0}')).to.deep.include({ online: false });
    });

    it("ignores unexpected types for each field", () => {
        const raw = '{"online":"yes","tem":"warm","hum":4290}';
        const out = parseLastData(raw);
        expect(out).to.deep.equal({ hum: 4290 });
    });

    it("ignores NaN/Infinity in tem/hum", () => {
        expect(parseLastData('{"tem":null,"hum":null}')).to.deep.equal({});
    });

    it("returns undefined on malformed JSON", () => {
        expect(parseLastData("not json")).to.equal(undefined);
        expect(parseLastData("")).to.equal(undefined);
        expect(parseLastData(undefined)).to.equal(undefined);
    });

    it("preserves battery when present", () => {
        expect(parseLastData('{"battery":75,"tem":2000}')).to.deep.include({
            battery: 75,
        });
    });
});

describe("AppApiClient — deviceSettings parser", () => {
    it("parses the captured H5179 settings payload", () => {
        const raw =
            '{"uploadRate":10,"temMin":-2000,"battery":100,"wifiName":"krobisnet","temMax":6000,"humMin":0,"humMax":10000,"fahOpen":false}';
        const out = parseSettings(raw);
        expect(out).to.include({
            uploadRate: 10,
            temMin: -2000,
            battery: 100,
            wifiName: "krobisnet",
            fahOpen: false,
        });
    });

    it("returns undefined on malformed input", () => {
        expect(parseSettings("not json")).to.equal(undefined);
        expect(parseSettings(undefined)).to.equal(undefined);
        expect(parseSettings("")).to.equal(undefined);
    });
});

describe("buildCapabilitiesFromAppEntry", () => {
    const base: AppDeviceEntry = {
        sku: "H5179",
        device: "45:D2:E8:76:C3:46:3C:1B",
        deviceName: "Wifi Thermometer",
    };

    it("emits online + sensorTemperature + sensorHumidity from full data", () => {
        const caps = buildCapabilitiesFromAppEntry({
            ...base,
            lastData: {
                online: true,
                tem: 2370,
                hum: 4290,
                lastTime: 1776704461000,
            },
        });
        expect(caps).to.have.lengthOf(3);
        expect(caps[0]).to.deep.include({
            type: "devices.capabilities.online",
            instance: "online",
        });
        expect(caps[0].state.value).to.equal(true);
        const temp = caps.find(
            (c) => c.instance === "sensorTemperature",
        );
        expect(temp?.state.value).to.be.closeTo(23.7, 0.0001);
        const hum = caps.find((c) => c.instance === "sensorHumidity");
        expect(hum?.state.value).to.be.closeTo(42.9, 0.0001);
    });

    it("divides tem/hum by 100 (Govee hundredths convention)", () => {
        const caps = buildCapabilitiesFromAppEntry({
            ...base,
            lastData: { tem: 100, hum: 5000 },
        });
        const temp = caps.find((c) => c.instance === "sensorTemperature");
        const hum = caps.find((c) => c.instance === "sensorHumidity");
        expect(temp?.state.value).to.equal(1);
        expect(hum?.state.value).to.equal(50);
    });

    it("returns [] when lastData is missing", () => {
        expect(buildCapabilitiesFromAppEntry(base)).to.deep.equal([]);
    });

    it("prefers lastData.battery over settings.battery", () => {
        const caps = buildCapabilitiesFromAppEntry({
            ...base,
            lastData: { battery: 80 },
            settings: { battery: 50 },
        });
        const bat = caps.find((c) => c.instance === "battery");
        expect(bat?.state.value).to.equal(80);
    });

    it("falls back to settings.battery when lastData has no battery", () => {
        const caps = buildCapabilitiesFromAppEntry({
            ...base,
            lastData: { tem: 2000 },
            settings: { battery: 60 },
        });
        const bat = caps.find((c) => c.instance === "battery");
        expect(bat?.state.value).to.equal(60);
    });

    it("omits battery capability when neither side has it", () => {
        const caps = buildCapabilitiesFromAppEntry({
            ...base,
            lastData: { tem: 2000 },
        });
        const bat = caps.find((c) => c.instance === "battery");
        expect(bat).to.equal(undefined);
    });

    it("tolerates an empty lastData gracefully", () => {
        expect(
            buildCapabilitiesFromAppEntry({ ...base, lastData: {} }),
        ).to.deep.equal([]);
    });
});
