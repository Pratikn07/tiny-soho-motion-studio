import { describe, expect, it } from "vitest";

describe("vision sidecar client", () => {
  it("rejects a non-loopback sidecar URL before a request can leave the machine", async () => {
    const { resolveVisionSidecarUrl } = await import("@/lib/vision/client");

    expect(resolveVisionSidecarUrl("https://example.com")).toEqual({
      ok: false,
      reason: "Vision sidecar URL must use a loopback host.",
    });
  });

  it("returns an unavailable health result when the optional sidecar is stopped", async () => {
    const { getVisionHealth } = await import("@/lib/vision/client");

    await expect(getVisionHealth("http://127.0.0.1:9")).resolves.toMatchObject({
      status: "unavailable",
      reason: expect.any(String),
    });
  });
});
