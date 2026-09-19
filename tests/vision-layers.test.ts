import { describe, expect, it } from "vitest";

describe("vision layers contract", () => {
  it("requires ordered dimensions-matched RGBA layer metadata", async () => {
    const { layerResultSchema } = await import("@/lib/vision/layers");
    const valid = {
      image: { width: 100, height: 80 },
      layers: [
        { id: "background", artifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5", zIndex: 0, alphaCoverage: 0.7, width: 100, height: 80 },
        { id: "subject", artifactId: "8478f04b-53d8-465d-a52b-000403b7d6a5", zIndex: 1, alphaCoverage: 0.3, width: 100, height: 80 },
      ],
      diagnostics: { recompositionMatchesInput: true, overlap: { classification: "not-evaluated", nonAuthoritative: true } },
      backend: { provider: "Fake", model: "fake", version: "1" },
    };

    expect(layerResultSchema.safeParse(valid).success).toBe(true);
    expect(layerResultSchema.safeParse({ ...valid, layers: [valid.layers[1], valid.layers[0]] }).success).toBe(false);
    expect(layerResultSchema.safeParse({ ...valid, layers: [{ ...valid.layers[0], width: 99 }, valid.layers[1]] }).success).toBe(false);
  });
});
