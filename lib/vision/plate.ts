import { z } from "zod";
import { ocrRegionSchema } from "./contracts";
import { visionArtifactIdSchema } from "./artifacts";

export const generationPlateModeSchema = z.enum([
  "original-with-protected-text",
  "layers-text-removed",
]);

export const generationPlateBuildRequestSchema = z.object({
  sourceArtifactId: visionArtifactIdSchema,
  typographyOverlayArtifactId: visionArtifactIdSchema,
  regions: z.array(ocrRegionSchema),
  mode: generationPlateModeSchema,
  layerArtifactIds: z.array(visionArtifactIdSchema).max(8).default([]),
});

export const generationPlateResultSchema = generationPlateBuildRequestSchema.pick({
  sourceArtifactId: true,
  typographyOverlayArtifactId: true,
}).extend({
  artifactId: visionArtifactIdSchema,
  mode: generationPlateModeSchema,
  textRemoved: z.boolean(),
  protectedRegionIds: z.array(z.string().min(1)),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  warnings: z.array(z.string()),
  provenance: z.record(z.string(), z.unknown()),
});

export type GenerationPlateBuildRequest = z.infer<typeof generationPlateBuildRequestSchema>;
export type GenerationPlateResult = z.infer<typeof generationPlateResultSchema>;
