import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getCapabilities } from "@/app/api/capabilities/route";
import { GET as getVisionHealth } from "@/app/api/vision/health/route";

const originalSidecarUrl = process.env.TINY_SOHO_VISION_SIDECAR_URL;

function localRequest(path: string) {
  return new NextRequest(`http://127.0.0.1:3001${path}`, { headers: { host: "127.0.0.1:3001" } });
}

afterEach(() => {
  if (originalSidecarUrl === undefined) delete process.env.TINY_SOHO_VISION_SIDECAR_URL;
  else process.env.TINY_SOHO_VISION_SIDECAR_URL = originalSidecarUrl;
});

describe("vision API routes", () => {
  it("keeps the static capability catalog available without the Python sidecar", async () => {
    const response = getCapabilities(localRequest("/api/capabilities"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: expect.arrayContaining([expect.objectContaining({ id: "image.segment", provider: "SAM 2" })]),
    });
  });

  it("returns a normal unavailable health response when the optional sidecar is stopped", async () => {
    process.env.TINY_SOHO_VISION_SIDECAR_URL = "http://127.0.0.1:9";
    const response = await getVisionHealth(localRequest("/api/vision/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      reason: expect.any(String),
    });
  });
});
