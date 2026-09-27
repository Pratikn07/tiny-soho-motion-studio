import { StudioError } from "@/lib/errors";
import { createVisionJobSchema, type VisionOperation } from "@/lib/creative-suite";

type VisionAsset = {
  id: string;
  projectId: string;
  kind: "source-image" | "source-video" | "source-audio" | "generated-video" | "derived-image" | "derived-video";
};

type VisionCapability = { capabilityId: string; status: "available" | "unavailable" };

const imageOperations = new Set<VisionOperation>(["inspect", "overlay", "plate", "ocr", "segment", "layers"]);
const optionalOperations = new Set<VisionOperation>(["ocr", "segment", "layers"]);

export function validateVisionJobRequest(value: unknown, scope: {
  sourceAsset: VisionAsset | null;
  inputAssets: VisionAsset[];
  capabilities?: VisionCapability[];
}) {
  const parsed = createVisionJobSchema.safeParse(value);
  if (!parsed.success) throw new StudioError(400, "invalid_vision_request", "Vision request is invalid.");
  const source = scope.sourceAsset;
  if (!source || source.id !== parsed.data.sourceAssetId || source.projectId !== parsed.data.projectId) {
    throw new StudioError(400, "invalid_vision_asset", "Vision source asset must belong to this project.");
  }
  const imageKinds = new Set<VisionAsset["kind"]>(["source-image", "derived-image"]);
  const videoKinds = new Set<VisionAsset["kind"]>(["source-video", "generated-video", "derived-video"]);
  if (imageOperations.has(parsed.data.operation) && !imageKinds.has(source.kind)) {
    throw new StudioError(400, "invalid_vision_asset", "This Vision operation requires an image source asset.");
  }
  if (parsed.data.operation === "compose" && !videoKinds.has(source.kind)) {
    throw new StudioError(400, "invalid_vision_asset", "Compose requires a video source asset.");
  }
  if (scope.inputAssets.some((asset) => asset.projectId !== parsed.data.projectId)) {
    throw new StudioError(400, "invalid_vision_asset", "Vision input assets must belong to this project.");
  }
  if (optionalOperations.has(parsed.data.operation)) {
    const status = scope.capabilities?.find((capability) => capability.capabilityId === parsed.data.operation)?.status;
    if (status !== "available") {
      throw new StudioError(409, "vision_operation_unavailable", `${parsed.data.operation} is unavailable in the hosted Vision service.`);
    }
  }
  if (parsed.data.operation === "compose") {
    const overlay = scope.inputAssets[0];
    if (!overlay || !imageKinds.has(overlay.kind)) {
      throw new StudioError(400, "invalid_vision_asset", "Compose requires an image overlay from this project.");
    }
  }
  return parsed.data;
}
