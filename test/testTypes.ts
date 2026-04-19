import { expect } from "chai";
import {
    normalizeDeviceId,
    classifyError,
    shortDeviceId,
    devicePrefix,
    normalizeUnit,
} from "../src/lib/types";

describe("Types utilities", () => {
    describe("normalizeDeviceId", () => {
        it("should remove colons and lowercase", () => {
            expect(normalizeDeviceId("AA:BB:CC:DD:EE:FF:00:11")).to.equal("aabbccddeeff0011");
        });

        it("should lowercase already clean IDs", () => {
            expect(normalizeDeviceId("AABBCCDDEEFF0011")).to.equal("aabbccddeeff0011");
        });

        it("should handle already normalized IDs", () => {
            expect(normalizeDeviceId("aabbccddeeff0011")).to.equal("aabbccddeeff0011");
        });

        it("should handle empty string", () => {
            expect(normalizeDeviceId("")).to.equal("");
        });

        // Regression: Cloud API drift — non-string device IDs must not crash.
        it("should return '' for undefined", () => {
            expect(normalizeDeviceId(undefined as unknown as string)).to.equal("");
        });

        it("should return '' for null", () => {
            expect(normalizeDeviceId(null as unknown as string)).to.equal("");
        });

        it("should return '' for numeric input", () => {
            expect(normalizeDeviceId(12345 as unknown as string)).to.equal("");
        });
    });

    describe("shortDeviceId", () => {
        it("should return last 4 hex chars", () => {
            expect(shortDeviceId("AA:BB:CC:DD:EE:FF:00:11")).to.equal("0011");
        });

        it("should handle short IDs", () => {
            expect(shortDeviceId("abcd")).to.equal("abcd");
        });

        it("should normalize before slicing", () => {
            expect(shortDeviceId("AA:BB")).to.equal("aabb");
        });
    });

    describe("devicePrefix", () => {
        it("should build sku_shortid folder name", () => {
            expect(devicePrefix("H7131", "AA:BB:CC:DD:EE:FF:AB:3F")).to.equal("h7131_ab3f");
        });

        it("should lowercase SKU", () => {
            expect(devicePrefix("H7172", "11:22:33:44:55:66:77:88")).to.equal("h7172_7788");
        });

        it("should sanitize SKU with whitespace or dots", () => {
            // Cloud can theoretically return quirky model strings — they must
            // NOT land in an object id. Whitelisted to [a-z0-9_-].
            expect(devicePrefix("H7160 V2", "11:22:33:44:55:66:AB:CD")).to.equal("h7160_v2_abcd");
            expect(devicePrefix("H7160.Pro", "11:22:33:44:55:66:77:88")).to.equal("h7160_pro_7788");
        });

        it("should fall back to 'unknown' when SKU is empty after sanitisation", () => {
            expect(devicePrefix("", "AA:BB:CC:DD:EE:FF:AB:3F")).to.equal("unknown_ab3f");
            expect(devicePrefix("...", "AA:BB:CC:DD:EE:FF:AB:3F")).to.equal("unknown_ab3f");
        });

        it("should not throw on non-string SKU", () => {
            expect(() =>
                devicePrefix(null as unknown as string, "AA:BB:CC:DD:EE:FF:AB:3F"),
            ).to.not.throw();
        });
    });

    describe("normalizeUnit", () => {
        it("should convert unit.percent to %", () => {
            expect(normalizeUnit("unit.percent")).to.equal("%");
        });

        it("should convert unit.celsius to °C", () => {
            expect(normalizeUnit("unit.celsius")).to.equal("°C");
        });

        it("should convert unit.fahrenheit to °F", () => {
            expect(normalizeUnit("unit.fahrenheit")).to.equal("°F");
        });

        it("should convert unit.kelvin to K", () => {
            expect(normalizeUnit("unit.kelvin")).to.equal("K");
        });

        it("should return unknown units as-is", () => {
            expect(normalizeUnit("rpm")).to.equal("rpm");
        });

        it("should return undefined for no unit", () => {
            expect(normalizeUnit(undefined)).to.be.undefined;
        });
    });

    describe("classifyError", () => {
        it("should classify ECONNREFUSED as NETWORK", () => {
            expect(classifyError(new Error("connect ECONNREFUSED 1.2.3.4:443"))).to.equal("NETWORK");
        });

        it("should classify ENOTFOUND as NETWORK", () => {
            expect(classifyError(new Error("getaddrinfo ENOTFOUND api.govee.com"))).to.equal("NETWORK");
        });

        it("should classify errors with .code as NETWORK", () => {
            const err = new Error("connect failed") as NodeJS.ErrnoException;
            err.code = "EHOSTUNREACH";
            expect(classifyError(err)).to.equal("NETWORK");
        });

        it("should classify EAI_AGAIN via .code as NETWORK", () => {
            const err = new Error("DNS lookup failed") as NodeJS.ErrnoException;
            err.code = "EAI_AGAIN";
            expect(classifyError(err)).to.equal("NETWORK");
        });

        it("should classify ETIMEDOUT via .code as TIMEOUT", () => {
            const err = new Error("connect failed") as NodeJS.ErrnoException;
            err.code = "ETIMEDOUT";
            expect(classifyError(err)).to.equal("TIMEOUT");
        });

        it("should classify timed out message as TIMEOUT", () => {
            expect(classifyError(new Error("Request timed out"))).to.equal("TIMEOUT");
        });

        it("should classify Timeout message as TIMEOUT", () => {
            expect(classifyError(new Error("Timeout waiting for response"))).to.equal("TIMEOUT");
        });

        it("should classify 401 as AUTH", () => {
            expect(classifyError(new Error("HTTP 401 Unauthorized"))).to.equal("AUTH");
        });

        it("should classify 403 as AUTH", () => {
            expect(classifyError(new Error("HTTP 403 Forbidden"))).to.equal("AUTH");
        });

        it("should classify Login failed as AUTH", () => {
            expect(classifyError(new Error("Login failed: invalid credentials"))).to.equal("AUTH");
        });

        it("should classify 429 as RATE_LIMIT", () => {
            expect(classifyError(new Error("HTTP 429 Too Many Requests"))).to.equal("RATE_LIMIT");
        });

        it("should classify Rate limited as RATE_LIMIT", () => {
            expect(classifyError(new Error("Rate limited by Govee: too many requests (status 429)"))).to.equal("RATE_LIMIT");
        });

        it("should classify unknown errors as UNKNOWN", () => {
            expect(classifyError(new Error("Something unexpected"))).to.equal("UNKNOWN");
        });

        it("should handle string errors", () => {
            expect(classifyError("ECONNREFUSED")).to.equal("NETWORK");
        });

        it("should handle non-Error objects", () => {
            expect(classifyError({ code: "ERR" })).to.equal("UNKNOWN");
        });
    });
});
