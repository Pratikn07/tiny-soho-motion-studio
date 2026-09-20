import { createSafeMotionPlan } from "@/lib/safe-motion/planner";
import type { CameraMotion, MotionVector, NormalizedBounds, SafeMotionPlan } from "@/lib/safe-motion/schema";
import type { OcrRegion } from "@/lib/vision/contracts";
import type { MotionPackageV2 } from "@/lib/vision/motion-package-v2";

export type VisionLabState = "idle" | "validating" | "loading-model" | "processing" | "success" | "unavailable" | "error";
export type CapabilityDisplay = "Available" | "Loading" | "Unavailable" | "Degraded" | "Error";

type RuntimeStatus = { state: "unloaded" | "loading" | "ready" | "error"; available: boolean; reason: string | null };
type CapabilityState = { status: "available" | "planned" | "unavailable"; unavailableReason?: string; runtimeStatus?: RuntimeStatus };

export type MotionPackageDraftInput = {
  projectId: string;
  assets: {
    sourceAssetId: string;
    generationPlateAssetId: string;
    typographyOverlayAssetId: string;
    segmentationMaskAssetId?: string;
    layerAssetIds?: string[];
  };
  plateMode: "original-with-protected-text" | "layers-text-removed";
  plateTextRemoved: boolean;
  ocr: { provider: string; model: string; regions: OcrRegion[] };
  segmentation?: { provider: string; model: string; bounds?: NormalizedBounds[] };
  layers?: { provider: string; model: string; diagnostics: Record<string, unknown> };
  subjectBounds: NormalizedBounds;
  requested: { subject: MotionVector; camera: CameraMotion };
  generation: MotionPackageV2["generation"];
};

export function stateFromResponse(status: number): VisionLabState {
  if (status >= 200 && status < 300) return "success";
  if (status === 503) return "unavailable";
  return "error";
}

export function planJson(plan: unknown): string {
  return JSON.stringify(plan, null, 2);
}

export function capabilityDisplay(capability: CapabilityState): CapabilityDisplay {
  if (capability.status === "unavailable") return "Unavailable";
  const runtime = capability.runtimeStatus;
  if (!runtime) return "Unavailable";
  if (runtime.state === "unloaded") return runtime.available ? "Loading" : "Unavailable";
  if (runtime.state === "loading") return "Loading";
  if (runtime.state === "error") return "Error";
  if (!runtime.available) return "Unavailable";
  return capability.status === "available" ? "Available" : "Degraded";
}

export function canRunCapability(capability: CapabilityState): boolean {
  const runtime = capability.runtimeStatus;
  if (capability.status === "unavailable" || !runtime?.available) return false;
  return runtime.state === "ready" || runtime.state === "unloaded";
}

export function canComposeFinal(job: { status: string; outputAssetId?: string | null } | null): boolean {
  return job?.status === "completed" && Boolean(job.outputAssetId);
}

export function selectGenerationAttemptId(savedAttemptId: string | null, inFlightAttemptId: string | null, create: () => string): string {
  return savedAttemptId || inFlightAttemptId || create();
}

export function buildMotionPackageDraft(input: MotionPackageDraftInput): MotionPackageV2 {
  const plan: SafeMotionPlan = createSafeMotionPlan({
    sourceArtifactId: input.assets.sourceAssetId,
    plateArtifactId: input.assets.generationPlateAssetId,
    plateMode: input.plateMode,
    subject: { id: "primary-subject", maskArtifactId: input.assets.segmentationMaskAssetId, bounds: input.subjectBounds },
    typography: input.ocr.regions.map((region) => ({ id: region.id, bounds: region.boundingBox })),
    segmentationBounds: input.segmentation?.bounds || [],
    requested: input.requested,
  });

  return {
    version: "2",
    projectId: input.projectId,
    sourceAssetId: input.assets.sourceAssetId,
    generationPlateAssetId: input.assets.generationPlateAssetId,
    typographyOverlayAssetId: input.assets.typographyOverlayAssetId,
    plateTextRemoved: input.plateTextRemoved,
    analysis: {
      ocr: input.ocr,
      ...(input.segmentation && input.assets.segmentationMaskAssetId ? {
        segmentation: { provider: input.segmentation.provider, model: input.segmentation.model, maskAssetId: input.assets.segmentationMaskAssetId },
      } : {}),
      ...(input.layers && input.assets.layerAssetIds?.length ? {
        layers: { provider: input.layers.provider, model: input.layers.model, layerAssetIds: input.assets.layerAssetIds, diagnostics: input.layers.diagnostics },
      } : {}),
    },
    plan,
    generation: input.generation,
    provenance: { source: "vision-lab", assetsPromoted: true },
  };
}
