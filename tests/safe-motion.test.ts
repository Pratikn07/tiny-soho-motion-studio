import { describe, expect, it } from "vitest";

describe("typography-safe motion planner", () => {
  it("keeps a collision-free requested subject motion unchanged and places typography above it", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const { TYPOGRAPHY_Z_INDEX } = await import("@/lib/safe-motion/typography");
    const plan = createSafeMotionPlan({
      subject: { id: "product", bounds: { x: 0.1, y: 0.1, width: 0.15, height: 0.15 } },
      typography: [{ id: "headline", bounds: { x: 0.7, y: 0.7, width: 0.2, height: 0.1 } }],
      requested: { subject: { x: 0.1, y: 0 }, camera: { x: 0, y: -0.02 } },
    });

    expect(plan.status).toBe("ready");
    expect(plan.final).toEqual(plan.requested);
    expect(plan.typography.zIndex).toBe(TYPOGRAPHY_Z_INDEX);
    expect(plan.collisions).toEqual([]);
  });

  it("deterministically reduces a motion whose swept bounds would cross typography", async () => {
    const { createSafeMotionPlan, sweptBounds } = await import("@/lib/safe-motion/planner");
    const plan = createSafeMotionPlan({
      subject: { id: "product", bounds: { x: 0.1, y: 0.4, width: 0.15, height: 0.15 } },
      typography: [{ id: "headline", bounds: { x: 0.45, y: 0.4, width: 0.2, height: 0.15 } }],
      requested: { subject: { x: 0.5, y: 0 }, camera: { x: 0, y: 0 } },
    });

    expect(plan.status).toBe("reduced");
    expect(plan.final?.subject.x).toBeLessThan(plan.requested.subject.x);
    expect(plan.warnings).toContain("Subject motion was reduced to avoid typography.");
    expect(sweptBounds(plan.subject.bounds, plan.final!.subject).x + sweptBounds(plan.subject.bounds, plan.final!.subject).width)
      .toBeLessThanOrEqual(0.45);
  });

  it("rejects a plan when the supplied subject already overlaps protected typography", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const plan = createSafeMotionPlan({
      subject: { id: "product", bounds: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } },
      typography: [{ id: "headline", bounds: { x: 0.45, y: 0.45, width: 0.2, height: 0.1 } }],
      requested: { subject: { x: 0.1, y: 0 }, camera: { x: 0, y: 0 } },
    });

    expect(plan.status).toBe("rejected");
    expect(plan.final).toBeNull();
    expect(plan.collisions[0]).toMatchObject({ kind: "typography", phase: "initial" });
  });

  it("reduces camera movement that would expose an unsafe fixed-overlay edge", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const plan = createSafeMotionPlan({
      sourceArtifactId: "source",
      plateArtifactId: "plate",
      plateMode: "original-with-protected-text",
      subject: { id: "product", bounds: { x: 0.1, y: 0.1, width: 0.15, height: 0.15 } },
      typography: [{ id: "headline", bounds: { x: 0.7, y: 0.7, width: 0.2, height: 0.1 } }],
      requested: { subject: { x: 0, y: 0 }, camera: { x: 0.1, y: 0, zoom: 0, type: "pan-safe" } },
      collisionPadding: 0.02,
    });

    expect(plan.version).toBe("2");
    expect(plan.status).toBe("reduced");
    expect(plan.final?.camera.x).toBe(0);
    expect(plan.collisions.some((collision) => collision.kind === "camera-edge")).toBe(true);
  });

  it("requires explicit behind-overlay mode and stationary motion for an initially overlapping subject", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const base = {
      subject: { id: "product", bounds: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } },
      typography: [{ id: "headline", bounds: { x: 0.45, y: 0.45, width: 0.2, height: 0.1 } }],
      requested: { subject: { x: 0, y: 0 }, camera: { x: 0, y: 0 } },
    };

    expect(createSafeMotionPlan(base).status).toBe("rejected");
    const behind = createSafeMotionPlan({ ...base, subjectLayerMode: "behind-fixed-overlay" });
    expect(behind.status).toBe("ready");
    expect(behind.warnings.some((warning) => warning.includes("behind the fixed typography overlay"))).toBe(true);
  });

  it("warns when OCR found no typography rather than silently treating that as a safety guarantee", async () => {
    const { createSafeMotionPlan } = await import("@/lib/safe-motion/planner");
    const plan = createSafeMotionPlan({
      subject: { id: "product", bounds: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } },
      typography: [],
      requested: { subject: { x: 0.01, y: 0 }, camera: { x: 0, y: 0 } },
    });

    expect(plan.status).toBe("ready");
    expect(plan.warnings).toContain("No typography was detected; review or explicitly confirm that this image has no protected text.");
  });
});
