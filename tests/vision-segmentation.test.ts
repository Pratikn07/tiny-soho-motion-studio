import { describe, expect, it } from "vitest";

describe("vision segmentation contract", () => {
  it("requires a positive point or a bounding box and rejects unsafe normalized values", async () => {
    const { segmentationPromptsSchema } = await import("@/lib/vision/segmentation");

    expect(segmentationPromptsSchema.safeParse({ negativePoints: [{ x: 0.5, y: 0.5 }] }).success).toBe(false);
    expect(segmentationPromptsSchema.safeParse({ positivePoints: [{ x: -0.1, y: 0.5 }] }).success).toBe(false);
    expect(segmentationPromptsSchema.safeParse({ boundingBox: { x: 0.9, y: 0.9, width: 0.2, height: 0.2 } }).success).toBe(false);
    expect(segmentationPromptsSchema.safeParse({ positivePoints: [{ x: 0.5, y: 0.5 }] }).success).toBe(true);
  });
});
