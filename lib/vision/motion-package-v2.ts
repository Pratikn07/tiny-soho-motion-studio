import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { preflightGeneration } from "@/lib/generation";
import { safeMotionPlanSchema, type SafeMotionPlan } from "@/lib/safe-motion/schema";
import type { Asset, createStore } from "@/lib/store";
import { ocrRegionSchema } from "./contracts";

const assetIdSchema = z.string().min(1).max(256);
const motionPromptSuffix = "Animate motion only in the visual content; do not add text, logos, or letters. Preserve composition and subject identity. Trusted typography is composited locally after generation.";
const maxMotionPromptInputLength = 5_000 - motionPromptSuffix.length - 1;

export const motionPackageV2Schema = z.object({
  version: z.literal("2"),
  projectId: assetIdSchema,
  sourceAssetId: assetIdSchema,
  generationPlateAssetId: assetIdSchema,
  typographyOverlayAssetId: assetIdSchema,
  plateTextRemoved: z.boolean(),
  analysis: z.object({
    ocr: z.object({ provider: z.string().min(1), model: z.string().min(1), regions: z.array(ocrRegionSchema) }),
    segmentation: z.object({ provider: z.string().min(1), model: z.string().min(1), maskAssetId: assetIdSchema }).optional(),
    layers: z.object({ provider: z.string().min(1), model: z.string().min(1), layerAssetIds: z.array(assetIdSchema).max(8), diagnostics: z.record(z.string(), z.unknown()) }).optional(),
  }),
  plan: safeMotionPlanSchema,
  generation: z.object({
    modelId: z.string().min(1),
    duration: z.number().int().positive(),
    resolution: z.string().min(1),
    aspectRatio: z.string().min(1),
    prompt: z.string().trim().min(1).max(maxMotionPromptInputLength),
    audio: z.boolean(),
  }).strict(),
  provenance: z.record(z.string(), z.unknown()),
}).strict();

export type MotionPackageV2 = {
  version: "2";
  projectId: string;
  sourceAssetId: string;
  generationPlateAssetId: string;
  typographyOverlayAssetId: string;
  plateTextRemoved: boolean;
  analysis: {
    ocr: { provider: string; model: string; regions: z.infer<typeof ocrRegionSchema>[] };
    segmentation?: { provider: string; model: string; maskAssetId: string };
    layers?: { provider: string; model: string; layerAssetIds: string[]; diagnostics: Record<string, unknown> };
  };
  plan: SafeMotionPlan;
  generation: { modelId: string; duration: number; resolution: string; aspectRatio: string; prompt: string; audio: boolean };
  provenance: Record<string, unknown>;
};

type CoreStore = ReturnType<typeof createStore>;
type OverlayInspection = { width: number; height: number; hasTransparentPixels: boolean };
type Dependencies = {
  db?: CoreStore;
  eligibleModels?: Set<string>;
  inspectOverlay?: (asset: Asset) => Promise<OverlayInspection>;
};

export async function createMotionPackageV2(raw: unknown, dependencies: Dependencies = {}): Promise<MotionPackageV2> {
  const input = motionPackageV2Schema.parse(raw);
  const db = dependencies.db;
  if (!db) throw new Error("A persistent store is required to validate MotionPackageV2.");
  if (!db.getProject(input.projectId)) throw new Error("Project not found.");

  const source = requireProjectImage(db, input.sourceAssetId, input.projectId, "source image", "source-image");
  const plate = requireProjectImage(db, input.generationPlateAssetId, input.projectId, "generation plate", "generation-plate");
  const overlay = requireProjectAsset(db, input.typographyOverlayAssetId, input.projectId, "typography overlay", "typography-overlay");
  if (overlay.mime !== "image/png") throw new Error("Typography overlay must be a transparent PNG asset.");
  assertMatchingDimensions(source, plate, overlay);
  assertPlanMatchesAssets(input.plan, input.sourceAssetId, input.generationPlateAssetId, input.plateTextRemoved);
  assertPlateProvenance(plate, input.plan, input.plateTextRemoved);

  const inspectOverlay = dependencies.inspectOverlay || inspectTransparentOverlay;
  const inspection = await inspectOverlay(overlay);
  if (inspection.width !== source.width || inspection.height !== source.height || !inspection.hasTransparentPixels) {
    throw new Error("Typography overlay must be a transparent PNG matching the project canvas dimensions.");
  }

  validateAnalysisAssets(db, input.projectId, input.analysis);
  const prompt = compileMotionPrompt(input.generation.prompt);
  const preflight = preflightGeneration(db, {
    projectId: input.projectId,
    idempotencyKey: "motion-package-v2-validation",
    modelId: input.generation.modelId,
    prompt,
    media: [{ assetId: input.generationPlateAssetId, role: "start-image" }],
    options: {
      duration: input.generation.duration,
      resolution: input.generation.resolution,
      aspectRatio: input.generation.aspectRatio,
      audio: input.generation.audio,
    },
  }, dependencies.eligibleModels || new Set());
  if (preflight.model.family !== "wan3" || preflight.task !== "image-to-video") throw new Error("MotionPackageV2 requires a reviewed Wan 3 first-frame video model.");
  assertCanvasOrApprovedAspect(source, input.generation.aspectRatio, input.projectId, db);

  return {
    version: "2",
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    generationPlateAssetId: input.generationPlateAssetId,
    typographyOverlayAssetId: input.typographyOverlayAssetId,
    plateTextRemoved: input.plateTextRemoved,
    analysis: input.analysis,
    plan: input.plan,
    generation: { ...input.generation, prompt },
    provenance: input.provenance,
  };
}

export function motionPackageV2Fingerprint(pkg: MotionPackageV2) {
  return createHash("sha256").update(canonicalJson(pkg)).digest("hex");
}

export function compileMotionPrompt(prompt: string) {
  return [prompt.trim(), motionPromptSuffix].join(" ");
}

function requireProjectAsset(db: CoreStore, assetId: string, projectId: string, label: string, expectedKind?: string) {
  const asset = db.getAsset(assetId);
  if (!asset) throw new Error(`MotionPackageV2 ${label} was not found.`);
  if (asset.projectId !== projectId) throw new Error("MotionPackageV2 assets must belong to the same project.");
  if (expectedKind && asset.kind !== expectedKind) throw new Error(`MotionPackageV2 ${label} must be a ${expectedKind} asset.`);
  return asset;
}

function requireProjectImage(db: CoreStore, assetId: string, projectId: string, label: string, expectedKind?: string) {
  const asset = requireProjectAsset(db, assetId, projectId, label, expectedKind);
  if (!asset.mime.startsWith("image/")) throw new Error(`MotionPackageV2 ${label} must be an image asset.`);
  return asset;
}

function assertMatchingDimensions(source: Asset, plate: Asset, overlay: Asset) {
  if (!source.width || !source.height || source.width !== plate.width || source.height !== plate.height || source.width !== overlay.width || source.height !== overlay.height) {
    throw new Error("MotionPackageV2 source, generation plate, and typography overlay must have matching dimensions.");
  }
}

function assertPlanMatchesAssets(plan: SafeMotionPlan, sourceAssetId: string, plateAssetId: string, plateTextRemoved: boolean) {
  if (!["ready", "reduced"].includes(plan.status) || !plan.final) throw new Error("MotionPackageV2 plan status must be ready or reduced.");
  if (plan.sourceArtifactId !== sourceAssetId || plan.plateArtifactId !== plateAssetId) throw new Error("MotionPackageV2 plan must identify the exact persistent source and generation plate.");
  const expectsTextRemoved = plan.plateMode === "layers-text-removed";
  if (plateTextRemoved !== expectsTextRemoved) throw new Error("MotionPackageV2 must record whether the generation plate actually has text removed.");
}

function assertPlateProvenance(plate: Asset, plan: SafeMotionPlan, plateTextRemoved: boolean) {
  let provenance: unknown;
  try {
    provenance = JSON.parse(plate.provenance);
  } catch {
    throw new Error("Generation plate provenance is invalid.");
  }
  const record = provenance && typeof provenance === "object" ? provenance as Record<string, unknown> : null;
  const vision = record?.vision && typeof record.vision === "object" ? record.vision as Record<string, unknown> : null;
  if (record?.source !== "vision-safe-motion" || vision?.kind !== "generation-plate" || vision.producer !== "generation-plate-builder") {
    throw new Error("Generation plate provenance must come from the trusted generation-plate promotion pipeline.");
  }
  const recordedMode = vision.plateMode;
  const recordedTextRemoved = vision.plateTextRemoved;
  if ((recordedMode !== "original-with-protected-text" && recordedMode !== "layers-text-removed") || typeof recordedTextRemoved !== "boolean") {
    throw new Error("Generation plate provenance must record its verified plate mode and text-removal state.");
  }
  if (recordedMode !== plan.plateMode || recordedTextRemoved !== plateTextRemoved) {
    throw new Error("Generation plate provenance does not match the requested Safe Motion package.");
  }
}

function validateAnalysisAssets(db: CoreStore, projectId: string, analysis: MotionPackageV2["analysis"]) {
  if (analysis.segmentation) requireProjectImage(db, analysis.segmentation.maskAssetId, projectId, "segmentation mask", "segmentation-mask");
  for (const layerAssetId of analysis.layers?.layerAssetIds || []) requireProjectImage(db, layerAssetId, projectId, "layer", "rgba-layer");
}

function assertCanvasOrApprovedAspect(source: Asset, aspectRatio: string, projectId: string, db: CoreStore) {
  const project = db.getProject(projectId)!;
  const canvas = project.canvas.match(/^(\d+)x(\d+)$/i);
  if (!source.width || !source.height) throw new Error("MotionPackageV2 source dimensions are missing.");
  if (canvas && source.width === Number(canvas[1]) && source.height === Number(canvas[2])) return;
  if (aspectRatio === "adaptive") return;
  const [width, height] = aspectRatio.split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.abs(source.width / source.height - width / height) > 0.001) {
    throw new Error("Generation plate dimensions must match the project canvas or selected model aspect ratio.");
  }
}

async function inspectTransparentOverlay(asset: Asset): Promise<OverlayInspection> {
  const decoded = await sharp(asset.path, { limitInputPixels: 80_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let hasTransparentPixels = false;
  for (let index = 3; index < decoded.data.length; index += decoded.info.channels) {
    if (decoded.data[index] < 255) {
      hasTransparentPixels = true;
      break;
    }
  }
  return { width: decoded.info.width, height: decoded.info.height, hasTransparentPixels };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
