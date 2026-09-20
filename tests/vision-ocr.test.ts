import { describe, expect, it } from "vitest";

describe("vision OCR contract", () => {
  it("rejects a region whose polygon escapes normalized coordinates", async () => {
    const { ocrResultSchema } = await import("@/lib/vision/contracts");

    expect(ocrResultSchema.safeParse({
      image: { width: 100, height: 100 },
      regions: [{
        id: "copy",
        text: "Copy",
        detectionConfidence: 1,
        recognitionConfidence: 1,
        polygon: [{ x: 0, y: 0 }, { x: 1.1, y: 0 }, { x: 1, y: 1 }],
        boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      }],
      engine: { provider: "Fake", model: "fake", version: "1" },
      typographySafetyMaskArtifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5",
    }).success).toBe(false);
  });
});
