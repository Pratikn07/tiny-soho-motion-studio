import { createHash } from "node:crypto";
import { preflightGeneration, queueGeneration, type GenerationDraft } from "@/lib/generation";
import type { createStore } from "@/lib/store";
import { motionPackageV2Fingerprint, type MotionPackageV2 } from "./motion-package-v2";

type CoreStore = ReturnType<typeof createStore>;

export class VisionGenerationBridge {
  constructor(private readonly db: CoreStore, private readonly eligibleModels: Set<string>) {}

  draftFor(pkg: MotionPackageV2, generationAttemptId: string): GenerationDraft {
    if (!generationAttemptId.trim()) throw new Error("An explicit generation attempt ID is required.");
    if (pkg.generation.duration < 3 || pkg.generation.duration > 5) throw new Error("Vision carousel motion is limited to 3–5 seconds.");
    const packageFingerprint = motionPackageV2Fingerprint(pkg);
    const idempotencyKey = createHash("sha256").update(`${pkg.projectId}:${packageFingerprint}:${generationAttemptId}`).digest("hex");
    return {
      projectId: pkg.projectId,
      idempotencyKey,
      modelId: pkg.generation.modelId,
      prompt: pkg.generation.prompt,
      media: [{ assetId: pkg.generationPlateAssetId, role: "start-image" }],
      options: { duration: pkg.generation.duration, resolution: pkg.generation.resolution, aspectRatio: pkg.generation.aspectRatio, promptExtend: true, audio: pkg.generation.audio },
      internalProvenance: {
        source: "vision-motion-package-v2",
        packageFingerprint,
        generationAttemptId,
        sourceAssetId: pkg.sourceAssetId,
        generationPlateAssetId: pkg.generationPlateAssetId,
        typographyOverlayAssetId: pkg.typographyOverlayAssetId,
        plateTextRemoved: pkg.plateTextRemoved,
      },
    };
  }

  preflight(pkg: MotionPackageV2, generationAttemptId: string) {
    return preflightGeneration(this.db, this.draftFor(pkg, generationAttemptId), this.eligibleModels);
  }

  queue(pkg: MotionPackageV2, generationAttemptId: string) {
    return queueGeneration(this.db, this.draftFor(pkg, generationAttemptId), this.eligibleModels);
  }
}
