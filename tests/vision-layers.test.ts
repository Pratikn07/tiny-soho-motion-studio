import { describe, expect, it } from "vitest";

describe("vision layers contract", () => {
  it("requires ordered dimensions-matched RGBA layer metadata", async () => {
    const { layerResultSchema } = await import("@/lib/vision/layers");
    const valid = {
      image: { width: 100, height: 80 },
      layers: [
        { id: "background", artifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5", zIndex: 0, alphaCoverage: 0.7, width: 100, height: 80 },
        { id: "subject", artifactId: "8478f04b-53d8-465d-a52b-000403b7d6a5", zIndex: 1, alphaCoverage: 0.3, width: 100, height: 80 },
        { id: "layer-3", artifactId: "7af1f2c6-70b1-4d85-9f43-2b954ad4f5ef", zIndex: 2, alphaCoverage: 0.2, width: 100, height: 80 },
        { id: "layer-4", artifactId: "f02f4249-e793-41d0-b075-ef0c0a9d2ebe", zIndex: 3, alphaCoverage: 0.2, width: 100, height: 80 },
      ],
      diagnostics: { recompositionMatchesInput: true, meanAbsoluteError: 0, warningThreshold: 0.02, warning: null, overlap: { classification: "not-evaluated", nonAuthoritative: true }, classifications: [
        { layerId: "background", textOverlap: 0, subjectOverlap: 0, inferredRole: "unknown", confidence: 0, nonAuthoritative: true },
        { layerId: "subject", textOverlap: 0, subjectOverlap: 0, inferredRole: "unknown", confidence: 0, nonAuthoritative: true },
        { layerId: "layer-3", textOverlap: 0, subjectOverlap: 0, inferredRole: "unknown", confidence: 0, nonAuthoritative: true },
        { layerId: "layer-4", textOverlap: 0, subjectOverlap: 0, inferredRole: "unknown", confidence: 0, nonAuthoritative: true },
      ] },
      backend: { provider: "Fake", model: "fake", version: "1" },
      options: { prompt: null, requestedLayerCount: 4, seed: 17 },
    };

    expect(layerResultSchema.safeParse(valid).success).toBe(true);
    expect(layerResultSchema.safeParse({ ...valid, layers: [valid.layers[1], valid.layers[0]] }).success).toBe(false);
    expect(layerResultSchema.safeParse({ ...valid, layers: [{ ...valid.layers[0], width: 99 }, valid.layers[1]] }).success).toBe(false);
  });
});
