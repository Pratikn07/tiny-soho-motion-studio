import { z } from "zod";
import { ocrRegionSchema } from "./contracts";
import { visionArtifactIdSchema } from "./artifacts";

export const typographyOverlayResultSchema = z.object({
  artifactId: visionArtifactIdSchema,
  sourceArtifactId: visionArtifactIdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  protectedRegionIds: z.array(z.string().min(1)),
});

export const typographyOverlayRegionsSchema = z.array(ocrRegionSchema);
export type TypographyOverlayResult = z.infer<typeof typographyOverlayResultSchema>;
