import { z } from "zod";
import { visionArtifactIdSchema } from "./artifacts";

export const normalizedPointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const normalizedBoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).superRefine((box, context) => {
  if (box.x + box.width > 1 || box.y + box.height > 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "Bounding box must stay within normalized image coordinates." });
});

export const ocrRegionSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  detectionConfidence: z.number().min(0).max(1).nullable(),
  recognitionConfidence: z.number().min(0).max(1).nullable(),
  polygon: z.array(normalizedPointSchema).min(3),
  boundingBox: normalizedBoundingBoxSchema,
  angleDegrees: z.number().nullable().optional(),
});

export const ocrResultSchema = z.object({
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  regions: z.array(ocrRegionSchema),
  engine: z.object({ provider: z.string().min(1), model: z.string().min(1), version: z.string().min(1) }),
  typographySafetyMaskArtifactId: visionArtifactIdSchema.nullable(),
});

export type OcrRegion = z.infer<typeof ocrRegionSchema>;
export type OcrResult = z.infer<typeof ocrResultSchema>;

export const segmentationPromptsSchema = z.object({
  positivePoints: z.array(normalizedPointSchema).max(20).default([]),
  negativePoints: z.array(normalizedPointSchema).max(20).default([]),
  boundingBox: normalizedBoundingBoxSchema.optional(),
}).superRefine((prompts, context) => {
  if (prompts.positivePoints.length === 0 && !prompts.boundingBox) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Segmentation requires a positive point or a bounding box." });
  }
});

export const segmentationResultSchema = z.object({
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  masks: z.array(z.object({
    id: z.string().min(1),
    artifactId: visionArtifactIdSchema,
    boundingBox: normalizedBoundingBoxSchema,
    score: z.number().min(0).max(1),
  })).min(1),
  engine: z.object({ provider: z.string().min(1), model: z.string().min(1), version: z.string().min(1) }),
});

export type SegmentationPrompts = z.infer<typeof segmentationPromptsSchema>;
export type SegmentationResult = z.infer<typeof segmentationResultSchema>;

const layerArtifactSchema = z.object({
  id: z.string().min(1),
  artifactId: visionArtifactIdSchema,
  zIndex: z.number().int().nonnegative(),
  alphaCoverage: z.number().min(0).max(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const layerResultSchema = z.object({
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  layers: z.array(layerArtifactSchema).min(1),
  diagnostics: z.object({
    recompositionMatchesInput: z.boolean(),
    overlap: z.object({
      classification: z.enum(["not-evaluated", "potential-overlap", "no-overlap"]),
      nonAuthoritative: z.literal(true),
    }),
    classifications: z.array(z.object({
      layerId: z.string().min(1),
      textOverlap: z.number().min(0).max(1),
      subjectOverlap: z.number().min(0).max(1),
      inferredRole: z.enum(["text-like", "subject-like", "background-like", "visual", "unknown"]),
      confidence: z.number().min(0).max(1),
      nonAuthoritative: z.literal(true),
    })),
  }),
  backend: z.object({ provider: z.string().min(1), model: z.string().min(1), version: z.string().min(1) }),
  options: z.object({
    prompt: z.string().max(1000).nullable(),
    requestedLayerCount: z.union([z.literal(4), z.literal(6), z.literal(8)]),
    seed: z.number().int().nullable(),
  }),
}).superRefine((result, context) => {
  for (const [index, layer] of result.layers.entries()) {
    if (layer.zIndex !== index) context.addIssue({ code: z.ZodIssueCode.custom, path: ["layers", index, "zIndex"], message: "Layers must have consecutive ascending z-indexes." });
    if (layer.width !== result.image.width || layer.height !== result.image.height) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["layers", index], message: "Layer dimensions must match the source image." });
    }
  }
});

export type LayerResult = z.infer<typeof layerResultSchema>;
