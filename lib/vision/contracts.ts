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
