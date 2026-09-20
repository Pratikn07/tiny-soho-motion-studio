import { describe, expect, it } from "vitest";
import { providerOutputProvenance } from "@/lib/media-transport/provider-output";

describe("provider output provenance", () => {
  it("keeps a provider result locator server-side with its 24-hour expiry", () => {
    const observedAt = Date.parse("2026-09-20T12:00:00.000Z");

    expect(providerOutputProvenance("https://bucket.aliyuncs.com/result.mp4", observedAt)).toEqual({
      url: "https://bucket.aliyuncs.com/result.mp4",
      expiresAt: "2026-09-21T12:00:00.000Z",
    });
  });
});
