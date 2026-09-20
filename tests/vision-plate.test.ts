import { describe, expect, it } from "vitest";

describe("generation plate browser contract", () => {
  it("does not represent unavailable inpainting as an executable plate mode", async () => {
    const { generationPlateBuildRequestSchema } = await import("@/lib/vision/plate");
    const request = {
      sourceArtifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5",
      typographyOverlayArtifactId: "8478f04b-53d8-465d-a52b-000403b7d6a5",
      regions: [],
      mode: "inpainted-text-removed",
    };

    expect(generationPlateBuildRequestSchema.safeParse(request).success).toBe(false);
  });
});
