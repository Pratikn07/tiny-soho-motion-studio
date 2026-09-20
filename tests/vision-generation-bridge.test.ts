import { describe, expect, it } from "vitest";
import { VisionGenerationBridge } from "@/lib/vision/generation-bridge";
import type { MotionPackageV2 } from "@/lib/vision/motion-package-v2";
import { createStore } from "@/lib/store";
import { serializeAlibabaJob } from "@/lib/providers/serializers";

describe("VisionGenerationBridge", () => {
  it("uses the shared preflight/queue path with deterministic attempt idempotency and compact lineage", () => {
    const db = createStore(":memory:");
    try {
      const project = db.createProject("Bridge");
      const plate = db.addAsset({ projectId: project.id, kind: "generation-plate", name: "plate", mime: "image/png", path: "/tmp/plate.png", width: 1080, height: 1440, duration: null, hash: "plate", provenance: "{}" });
      const pkg = {
        version: "2", projectId: project.id, sourceAssetId: "asset_source", generationPlateAssetId: plate.id, typographyOverlayAssetId: "asset_overlay", plateTextRemoved: false,
        analysis: { ocr: { provider: "PaddleOCR", model: "test", regions: [] } }, plan: {},
        generation: { modelId: "alibaba:wan3-video", duration: 3, resolution: "720P", aspectRatio: "3:4", prompt: "Animate visual content only. Do not add text, logos, or letters. Preserve composition.", audio: false }, provenance: {},
      } as unknown as MotionPackageV2;
      const bridge = new VisionGenerationBridge(db, new Set(["alibaba:wan3-video"]));
      const first = bridge.queue(pkg, "attempt-1");
      const second = bridge.queue(pkg, "attempt-1");
      const third = bridge.queue(pkg, "attempt-2");
      expect(second.id).toBe(first.id);
      expect(third.id).not.toBe(first.id);
      expect(JSON.parse(first.options)).toMatchObject({ internalProvenance: { source: "vision-motion-package-v2", generationAttemptId: "attempt-1", generationPlateAssetId: plate.id } });
      expect(JSON.stringify(serializeAlibabaJob(first, [{ role: "start-image", mime: "image/png", bytes: Buffer.from("plate") }]).body)).not.toContain("internalProvenance");
      expect(JSON.stringify(serializeAlibabaJob({ ...first, modelId: "alibaba:wan2.7-image" }, []).body)).not.toContain("internalProvenance");
      expect(() => bridge.queue({ ...pkg, generation: { ...pkg.generation, duration: 6 } }, "attempt-3")).toThrow(/3–5 seconds/i);
    } finally { db.close(); }
  });
});
