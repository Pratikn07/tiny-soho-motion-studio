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

export const generationPlateSchema = z.object({
  artifactId: visionArtifactIdSchema,
  sourceArtifactId: visionArtifactIdSchema,
  mode: z.enum(["original-with-protected-text", "layers-text-removed"]),
  textRemoved: z.boolean(),
  protectedRegionIds: z.array(z.string().min(1)),
}).superRefine((plate, context) => {
  const requiresTextRemoval = plate.mode !== "original-with-protected-text";
  if (plate.textRemoved !== requiresTextRemoval) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Generation plate mode and textRemoved must agree." });
  }
});

export type GenerationPlateDescriptor = z.infer<typeof generationPlateSchema>;

export type MotionPackage = {
  version: "2";
  sourceBackgroundArtifactId: string;
  sourceImage: { artifactId: string };
  generationPlate: GenerationPlateDescriptor;
  typographyOverlay: TypographyOverlay;
  plan: SafeMotionPlan;
  generationHints: { avoidTextGeneration: true; preserveComposition: true };
  provenance: { overlayMode: "original-region-patch"; protectedRegionIds: string[]; plateMode: GenerationPlateDescriptor["mode"] };
};

export type MotionPackageInput = Pick<MotionPackage, "sourceBackgroundArtifactId" | "typographyOverlay" | "plan"> & {
  generationPlate?: GenerationPlateDescriptor;
};

export function createMotionPackage(input: MotionPackageInput): MotionPackage {
  const typographyOverlay = typographyOverlaySchema.parse(input.typographyOverlay);
  if (input.plan.status === "rejected" || input.plan.final === null) {
    throw new Error("A rejected motion plan cannot become a generation package.");
  }
  const sourceBackgroundArtifactId = visionArtifactIdSchema.parse(input.sourceBackgroundArtifactId);
  const generationPlate = generationPlateSchema.parse(input.generationPlate ?? {
    artifactId: sourceBackgroundArtifactId,
    sourceArtifactId: sourceBackgroundArtifactId,
    mode: "original-with-protected-text",
    textRemoved: false,
    protectedRegionIds: typographyOverlay.protectedRegionIds,
  });
  if (generationPlate.sourceArtifactId !== sourceBackgroundArtifactId) {
    throw new Error("Generation plate provenance must point to the supplied source artifact.");
  }
  if (input.plan.sourceArtifactId !== sourceBackgroundArtifactId || input.plan.plateArtifactId !== generationPlate.artifactId) {
    throw new Error("Safe Motion plan must identify the exact source and generation plate used by this package.");
  }
  if (input.plan.plateMode !== generationPlate.mode) {
    throw new Error("Safe Motion plan and generation plate mode must agree.");
  }
  if (!generationPlate.textRemoved) {
    if (!sameRegionIds(generationPlate.protectedRegionIds, typographyOverlay.protectedRegionIds)) {
      throw new Error("A text-retaining generation plate requires a trusted overlay for every protected region.");
    }
    if (vectorMagnitude(input.plan.final.subject) > 0.25 || vectorMagnitude(input.plan.final.camera) > 0.1) {
      throw new Error("A generation plate with protected text requires conservative motion.");
    }
  }
  return {
    version: "2",
    sourceBackgroundArtifactId,
    sourceImage: { artifactId: sourceBackgroundArtifactId },
    generationPlate,
    typographyOverlay,
    plan: input.plan,
    generationHints: { avoidTextGeneration: true, preserveComposition: true },
    provenance: { overlayMode: typographyOverlay.mode, protectedRegionIds: typographyOverlay.protectedRegionIds, plateMode: generationPlate.mode },
  };
}

function sameRegionIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function vectorMagnitude(vector: { x: number; y: number }): number {
  return Math.hypot(vector.x, vector.y);
}
