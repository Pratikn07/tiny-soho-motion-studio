import { describe, expect, it } from "vitest";

describe("motion package bridge", () => {
  it("builds a deterministic no-text-generation prompt and never submits from the mock bridge", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const { createMotionPackage } = await import("@/lib/safe-motion/motion-package");
    const { buildWanCompatiblePrompt } = await import("@/lib/safe-motion/prompt");
    const { MockVisionGenerationBridge } = await import("@/lib/safe-motion/bridge");
    const plan = createSafeMotionPlan({
      subject: { id: "product", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
      typography: [],
      requested: { subject: { x: 0.1, y: 0 }, camera: { x: 0, y: 0 } },
    });
    const pkg = createMotionPackage({
      sourceBackgroundArtifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5",
      typographyOverlay: {
        artifactId: "8478f04b-53d8-465d-a52b-000403b7d6a5",
        width: 100,
        height: 80,
        protectedRegionIds: ["headline"],
        mode: "original-region-patch",
      },
      plan,
    });

    const prompt = buildWanCompatiblePrompt(pkg);
    const draft = new MockVisionGenerationBridge().prepare(pkg);

    expect(prompt).toContain("Do not generate, alter, or redraw text");
    expect(prompt).toContain("Typography is composited locally");
    expect(draft).toMatchObject({ submitted: false, mode: "mock" });
    expect(draft.prompt).toBe(prompt);
    expect(pkg.generationPlate).toMatchObject({
      artifactId: pkg.sourceImage.artifactId,
      mode: "original-with-protected-text",
      textRemoved: false,
      protectedRegionIds: ["headline"],
    });
    expect(pkg.provenance.overlayMode).toBe("original-region-patch");
  });

  it("rejects a high-motion request when the generation plate retains protected text", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const { createMotionPackage } = await import("@/lib/safe-motion/motion-package");
    const plan = createSafeMotionPlan({
      subject: { id: "product", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
      typography: [],
      requested: { subject: { x: 0.4, y: 0 }, camera: { x: 0, y: 0 } },
    });

    expect(() => createMotionPackage({
      sourceBackgroundArtifactId: "c9789826-61ce-4ffd-9934-827ce92b6bd5",
      typographyOverlay: {
        artifactId: "8478f04b-53d8-465d-a52b-000403b7d6a5",
        width: 100,
        height: 80,
        protectedRegionIds: ["headline"],
        mode: "original-region-patch",
      },
      plan,
    })).toThrow(/conservative/i);
  });
});
