import { describe, expect, it } from "vitest";
import { capabilitySchema, getCapability } from "@/lib/capabilities";

describe("capability registry", () => {
  it("publishes the complete VISION-01 catalog with provenance and explicit unavailable state", async () => {
    const { listCapabilities } = await import("@/lib/capabilities");
    const capabilities = listCapabilities();

    expect(capabilities.map((capability) => capability.id)).toEqual([
      "image.ocr",
      "image.layers",
      "image.segment",
      "image.inpaint",
      "video.compose.typography",
    ]);

    for (const id of ["image.ocr", "image.layers", "image.segment", "video.compose.typography"]) {
      const capability = capabilities.find((candidate) => candidate.id === id);
      expect(capability).toMatchObject({
        id,
        runtime: expect.any(String),
        provider: expect.any(String),
        version: expect.any(String),
        hardwareRequirements: expect.any(Object),
        inputs: expect.any(Array),
        outputs: expect.any(Array),
        upstream: {
          repository: expect.stringMatching(/^https:\/\//),
          pinnedRef: expect.stringMatching(/^[a-z0-9.-]+$/i),
          codeLicense: expect.any(String),
          modelLicense: expect.any(String),
        },
      });
    }

    expect(capabilities.find((capability) => capability.id === "image.inpaint")).toMatchObject({
      status: "unavailable",
      unavailableReason: expect.stringMatching(/reserved/i),
    });

    expect(capabilities.find((capability) => capability.id === "image.ocr")?.upstream?.modelLicense).toMatch(/^Apache-2\.0/);
    expect(capabilities.find((capability) => capability.id === "image.segment")?.upstream?.modelLicense).toMatch(/^Apache-2\.0/);
  });

  it("rejects a null unavailable reason even though planned sidecar entries may omit one", () => {
    const reserved = getCapability("image.inpaint");
    if (!reserved) throw new Error("Reserved inpainting capability was missing from the catalog.");

    expect(() => capabilitySchema.parse({ ...reserved, unavailableReason: null })).toThrow(/Unavailable capabilities require an unavailable reason/i);
  });
});
