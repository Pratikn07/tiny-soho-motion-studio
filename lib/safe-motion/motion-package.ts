import { z } from "zod";
import { visionArtifactIdSchema } from "@/lib/vision/artifacts";
import type { SafeMotionPlan } from "./schema";

export const typographyOverlaySchema = z.object({
  artifactId: visionArtifactIdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  protectedRegionIds: z.array(z.string().min(1)),
});

export type TypographyOverlay = z.infer<typeof typographyOverlaySchema>;

export type MotionPackage = {
  version: "1";
  sourceBackgroundArtifactId: string;
  typographyOverlay: TypographyOverlay;
  plan: SafeMotionPlan;
  generationHints: { avoidTextGeneration: true; preserveComposition: true };
};

export function createMotionPackage(input: Omit<MotionPackage, "version" | "generationHints">): MotionPackage {
  const typographyOverlay = typographyOverlaySchema.parse(input.typographyOverlay);
  if (input.plan.status === "rejected" || input.plan.final === null) {
    throw new Error("A rejected motion plan cannot become a generation package.");
  }
  const sourceBackgroundArtifactId = visionArtifactIdSchema.parse(input.sourceBackgroundArtifactId);
  return {
    version: "1",
    sourceBackgroundArtifactId,
    typographyOverlay,
    plan: input.plan,
    generationHints: { avoidTextGeneration: true, preserveComposition: true },
  };
}
