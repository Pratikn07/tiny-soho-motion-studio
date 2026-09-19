import { describe, expect, it } from "vitest";

describe("local typography composition contracts", () => {
  it("accepts only opaque artifact IDs and calculates contain-and-pad previews", async () => {
    const { typographyCompositionRequestSchema } = await import("@/lib/vision/composer");
    const { previewTransform } = await import("@/lib/vision/preview");
    const request = {
      videoArtifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5",
      overlayArtifactId: "8478f04b-53d8-465d-a52b-000403b7d6a5",
    };

    expect(typographyCompositionRequestSchema.safeParse(request).success).toBe(true);
    expect(typographyCompositionRequestSchema.safeParse({ ...request, videoArtifactId: "../../clip.mp4" }).success).toBe(false);
    expect(previewTransform({ width: 1080, height: 1440 }, { width: 1080, height: 1920 })).toEqual({ scale: 1, x: 0, y: 240 });
  });
});
