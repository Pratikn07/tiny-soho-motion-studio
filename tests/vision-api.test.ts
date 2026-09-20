import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getCapabilities } from "@/app/api/capabilities/route";
import { GET as getVisionHealth } from "@/app/api/vision/health/route";

const originalSidecarUrl = process.env.TINY_SOHO_VISION_SIDECAR_URL;

function localRequest(path: string) {
  return new NextRequest(`http://127.0.0.1:3001${path}`, { headers: { host: "127.0.0.1:3001" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSidecarUrl === undefined) delete process.env.TINY_SOHO_VISION_SIDECAR_URL;
  else process.env.TINY_SOHO_VISION_SIDECAR_URL = originalSidecarUrl;
});

describe("vision API routes", () => {
  it("keeps the capability catalog usable and marks sidecar work unavailable when Python is stopped", async () => {
    process.env.TINY_SOHO_VISION_SIDECAR_URL = "http://127.0.0.1:9";
    const response = await getCapabilities(localRequest("/api/capabilities"));

    expect(response.status).toBe(200);
    const body = await response.json() as { sidecar: unknown; capabilities: Array<{ id: string }> };
    expect(body.sidecar).toMatchObject({ status: "unavailable", reason: expect.any(String) });
    expect(body.capabilities.find((capability) => capability.id === "image.segment")).toMatchObject({
      id: "image.segment",
      provider: "SAM 2",
      runtimeStatus: { state: "unloaded", available: false, reason: expect.any(String) },
    });
  });

  it("preserves a ready runtime status from a Pydantic capability payload with a null optional reason", async () => {
    process.env.TINY_SOHO_VISION_SIDECAR_URL = "http://127.0.0.1:8766";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      capabilities: [{
        id: "image.ocr",
        name: "PaddleOCR",
        status: "planned",
        runtime: "python-fastapi",
        provider: "PaddleOCR",
        version: "source-pinned",
        hardwareRequirements: { cpu: "required", mps: "not-supported", cuda: "optional" },
        inputs: ["image"],
        outputs: ["text", "text-blocks"],
        upstream: {
          repository: "https://github.com/PaddlePaddle/PaddleOCR",
          pinnedRef: "dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf",
          codeLicense: "Apache-2.0",
          modelLicense: "Apache-2.0",
        },
        unavailableReason: null,
        runtimeStatus: {
          capabilityId: "image.ocr",
          backend: "PaddleOcrAdapter",
          state: "ready",
          available: true,
          reason: null,
        },
      }],
      hardware: {
        cpu: { available: true, cores: 10, architecture: "arm64" },
        mps: { available: false, reason: "PyTorch is not installed; MPS cannot be checked." },
        cuda: { available: false, deviceCount: 0, reason: "PyTorch is not installed; CUDA cannot be checked." },
      },
    }), { status: 200 }));

    const response = await getCapabilities(localRequest("/api/capabilities"));
    const body = await response.json() as { capabilities: Array<{ id: string; runtimeStatus?: unknown }> };

    expect(body.capabilities.find((capability) => capability.id === "image.ocr")?.runtimeStatus).toEqual({
      capabilityId: "image.ocr",
      backend: "PaddleOcrAdapter",
      state: "ready",
      available: true,
      reason: null,
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
