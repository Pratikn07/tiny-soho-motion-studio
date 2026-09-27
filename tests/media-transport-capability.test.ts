import { describe, expect, it } from "vitest";
import { configuredTransportCapability, effectiveTransportCapability, type MediaTransportCapability } from "@/lib/media-transport/capability";

describe("zero-cost media transport capability", () => {
  const base: MediaTransportCapability = {
    id: "bailian-temporary-upload",
    state: "verified",
    region: "ap-southeast-1",
    models: ["wan2.7-r2v-2026-06-12", "wan3.0-video"],
    expiresAfterSeconds: 172800,
    lastVerifiedAt: "2026-09-20T00:00:00.000Z",
  };

  it("defaults URL-required local media to probe-required without an operator record", () => {
    expect(configuredTransportCapability({})).toMatchObject({
      id: "bailian-temporary-upload",
      state: "probe-required",
      region: "ap-southeast-1",
      models: ["wan2.7-r2v-2026-06-12", "wan3.0-video"],
    });
  });

  it("accepts only an exact Singapore verified record for the requested model", () => {
    expect(effectiveTransportCapability(base, "wan3.0-video")).toMatchObject({ state: "verified" });
    expect(effectiveTransportCapability({ ...base, region: "cn-beijing" }, "wan3.0-video")).toMatchObject({ state: "unavailable" });
    expect(effectiveTransportCapability(base, "wan2.7-i2v-2026-04-25")).toMatchObject({ state: "unavailable" });
  });

  it("fails closed for malformed or stale environment records", () => {
    expect(configuredTransportCapability({ TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY: "not-json" })).toMatchObject({ state: "probe-required" });
    expect(configuredTransportCapability({ TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY: JSON.stringify({ ...base, state: "verified", lastVerifiedAt: "not-a-date" }) })).toMatchObject({ state: "probe-required" });
  });
});
