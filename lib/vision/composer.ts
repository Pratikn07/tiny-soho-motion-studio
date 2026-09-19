import { z } from "zod";
import { visionArtifactIdSchema } from "./artifacts";

export const typographyCompositionRequestSchema = z.object({
  videoArtifactId: visionArtifactIdSchema,
  overlayArtifactId: visionArtifactIdSchema,
});

export const typographyCompositionResultSchema = z.object({
  artifactId: visionArtifactIdSchema,
});

export type TypographyCompositionRequest = z.infer<typeof typographyCompositionRequestSchema>;
export type TypographyCompositionResult = z.infer<typeof typographyCompositionResultSchema>;
