import { z } from "zod";
import { visionArtifactIdSchema } from "@/lib/vision/artifacts";
import type { SafeMotionPlan } from "./schema";

export const typographyOverlaySchema = z.object({
  artifactId: visionArtifactIdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  protectedRegionIds: z.array(z.string().min(1)),
  mode: z.literal("original-region-patch").default("original-region-patch"),
});

export type TypographyOverlay = z.infer<typeof typographyOverlaySchema>;

export type MotionPackage = {
  version: "1";
  sourceBackgroundArtifactId: string;
  sourceImage: { artifactId: string };
  generationPlate: { artifactId: string };
  typographyOverlay: TypographyOverlay;
  plan: SafeMotionPlan;
  generationHints: { avoidTextGeneration: true; preserveComposition: true };
  provenance: { overlayMode: "original-region-patch"; protectedRegionIds: string[] };
};

export type MotionPackageInput = Pick<MotionPackage, "sourceBackgroundArtifactId" | "typographyOverlay" | "plan">;

export function createMotionPackage(input: MotionPackageInput): MotionPackage {
  const typographyOverlay = typographyOverlaySchema.parse(input.typographyOverlay);
  if (input.plan.status === "rejected" || input.plan.final === null) {
    throw new Error("A rejected motion plan cannot become a generation package.");
  }
  const sourceBackgroundArtifactId = visionArtifactIdSchema.parse(input.sourceBackgroundArtifactId);
  return {
    version: "1",
    sourceBackgroundArtifactId,
    sourceImage: { artifactId: sourceBackgroundArtifactId },
    generationPlate: { artifactId: sourceBackgroundArtifactId },
    typographyOverlay,
    plan: input.plan,
    generationHints: { avoidTextGeneration: true, preserveComposition: true },
    provenance: { overlayMode: typographyOverlay.mode, protectedRegionIds: typographyOverlay.protectedRegionIds },
  };
}
