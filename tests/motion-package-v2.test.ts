import { afterEach, describe, expect, it } from "vitest";
import { createSafeMotionPlan } from "@/lib/safe-motion/planner";
import { createStore } from "@/lib/store";

describe("persistent MotionPackageV2", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  afterEach(() => stores.splice(0).forEach((db) => db.close()));

  function fixture() {
    const db = createStore(":memory:");
    stores.push(db);
    const project = db.createProject("Motion package");
    const addImage = (name: string, kind = "generation-plate", projectId = project.id, provenance = "{}") => db.addAsset({ projectId, kind, name, mime: "image/png", path: `/tmp/${name}`, width: 1080, height: 1440, duration: null, hash: name, provenance });
    const source = addImage("source", "source-image");
    const plate = addImage("plate", "generation-plate", project.id, JSON.stringify({
      source: "vision-safe-motion",
      vision: { kind: "generation-plate", producer: "generation-plate-builder", plateMode: "original-with-protected-text", plateTextRemoved: false },
    }));
    const overlay = addImage("overlay", "typography-overlay");
    const plan = createSafeMotionPlan({
      sourceArtifactId: source.id,
      plateArtifactId: plate.id,
      plateMode: "original-with-protected-text",
      subject: { id: "product", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
      typography: [],
      requested: { subject: { x: 0.05, y: 0 }, camera: { x: 0, y: 0 } },
    });
    return { db, project, source, plate, overlay, plan, addImage };
  }

  function request({ project, source, plate, overlay, plan }: ReturnType<typeof fixture>) {
    return {
      version: "2" as const,
      projectId: project.id,
      sourceAssetId: source.id,
      generationPlateAssetId: plate.id,
      typographyOverlayAssetId: overlay.id,
      plateTextRemoved: false,
      analysis: { ocr: { provider: "PaddleOCR", model: "PP-OCRv5_mobile", regions: [] } },
      plan,
      generation: {
        modelId: "alibaba:wan3-video",
        duration: 3,
        resolution: "720P",
        aspectRatio: "3:4",
        prompt: "Animate visual content with gentle motion only. Do not generate text, logos, or letters. Preserve composition and subject identity.",
        audio: false,
      },
      provenance: { source: "test" },
    };
  }

  it("validates project-owned persistent assets and model options without queuing a job", async () => {
    const data = fixture();
    const { createMotionPackageV2, motionPackageV2Fingerprint } = await import("@/lib/vision/motion-package-v2");
    const packageV2 = await createMotionPackageV2(request(data), {
      db: data.db,
      eligibleModels: new Set(["alibaba:wan3-video"]),
      inspectOverlay: async () => ({ width: 1080, height: 1440, hasTransparentPixels: true }),
    });

    expect(packageV2).toMatchObject({
      version: "2",
      projectId: data.project.id,
      sourceAssetId: data.source.id,
      generationPlateAssetId: data.plate.id,
      typographyOverlayAssetId: data.overlay.id,
      plateTextRemoved: false,
      generation: { modelId: "alibaba:wan3-video", duration: 3, aspectRatio: "3:4", audio: false },
    });
    expect(data.db.listJobs(data.project.id)).toEqual([]);
    expect(motionPackageV2Fingerprint(packageV2)).toMatch(/^[a-f0-9]{64}$/);
    expect(packageV2.generation.prompt.length).toBeLessThanOrEqual(5_000);
    expect(packageV2.generation.prompt).toContain("do not add text, logos, or letters");
  });

  it("rejects cross-project assets, opaque overlays, rejected plans, and unsupported model options", async () => {
    const data = fixture();
    const { createMotionPackageV2 } = await import("@/lib/vision/motion-package-v2");
    const foreignProject = data.db.createProject("Other project");
    const foreignPlate = data.addImage("foreign-plate", "generation-plate", foreignProject.id);
    const dependencies = { db: data.db, eligibleModels: new Set(["alibaba:wan3-video"]), inspectOverlay: async () => ({ width: 1080, height: 1440, hasTransparentPixels: false }) };

    await expect(createMotionPackageV2({ ...request(data), generationPlateAssetId: foreignPlate.id }, dependencies)).rejects.toThrow(/same project/i);
    await expect(createMotionPackageV2(request(data), dependencies)).rejects.toThrow(/transparent PNG/i);
    await expect(createMotionPackageV2({ ...request(data), generation: { ...request(data).generation, resolution: "4K" } }, { ...dependencies, inspectOverlay: async () => ({ width: 1080, height: 1440, hasTransparentPixels: true }) })).rejects.toThrow(/resolution/i);
    await expect(createMotionPackageV2({ ...request(data), plan: { ...data.plan, status: "rejected", final: null } }, { ...dependencies, inspectOverlay: async () => ({ width: 1080, height: 1440, hasTransparentPixels: true }) })).rejects.toThrow(/ready or reduced/i);
    const unverifiedPlate = data.addImage("unverified-plate");
    await expect(createMotionPackageV2({ ...request(data), generationPlateAssetId: unverifiedPlate.id, plan: { ...data.plan, plateArtifactId: unverifiedPlate.id } }, { ...dependencies, inspectOverlay: async () => ({ width: 1080, height: 1440, hasTransparentPixels: true }) })).rejects.toThrow(/provenance/i);
    await expect(createMotionPackageV2({ ...request(data), plan: { ...data.plan, textPolicy: { ...data.plan.textPolicy, keepOverlayFixed: false } } }, { ...dependencies, inspectOverlay: async () => ({ width: 1080, height: 1440, hasTransparentPixels: true }) })).rejects.toThrow();
  });
});
