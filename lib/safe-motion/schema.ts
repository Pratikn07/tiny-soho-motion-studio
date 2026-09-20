import { z } from "zod";

export const normalizedBoundsSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).superRefine((bounds, context) => {
  if (bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Bounds must stay within normalized canvas coordinates." });
  }
});

export const motionVectorSchema = z.object({
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
});

export const cameraMotionSchema = motionVectorSchema.extend({
  zoom: z.number().min(-0.5).max(0.5).default(0),
  type: z.enum(["static-subject", "tiny-push", "subtle-subject", "pan-safe", "custom"]).default("custom"),
});

export const motionSubjectSchema = z.object({ id: z.string().min(1), maskArtifactId: z.string().min(1).optional(), bounds: normalizedBoundsSchema });
export const typographyRegionSchema = z.object({ id: z.string().min(1), bounds: normalizedBoundsSchema });

export const safeMotionInputSchema = z.object({
  sourceArtifactId: z.string().min(1).optional(),
  plateArtifactId: z.string().min(1).optional(),
  plateMode: z.enum(["original-with-protected-text", "layers-text-removed"]).default("original-with-protected-text"),
  subject: motionSubjectSchema,
  typography: z.array(typographyRegionSchema),
  segmentationBounds: z.array(normalizedBoundsSchema).default([]),
  requested: z.object({ subject: motionVectorSchema, camera: cameraMotionSchema }),
  subjectLayerMode: z.enum(["avoid-typography", "behind-fixed-overlay"]).default("avoid-typography"),
  noTypographyConfirmed: z.boolean().default(false),
  collisionPadding: z.number().min(0).max(0.1).default(0.02),
});

export type NormalizedBounds = z.infer<typeof normalizedBoundsSchema>;
export type MotionVector = z.infer<typeof motionVectorSchema>;
export type CameraMotion = z.infer<typeof cameraMotionSchema>;
export type SafeMotionInput = z.infer<typeof safeMotionInputSchema>;

export type MotionCollision = {
  kind: "typography" | "segmentation" | "canvas" | "camera-edge";
  id: string;
  phase: "initial" | "requested" | "candidate";
  bounds: NormalizedBounds;
};

export const motionCollisionSchema = z.object({
  kind: z.enum(["typography", "segmentation", "canvas", "camera-edge"]),
  id: z.string().min(1),
  phase: z.enum(["initial", "requested", "candidate"]),
  bounds: normalizedBoundsSchema,
});

export const safeMotionPlanSchema = z.object({
  version: z.literal("2"),
  sourceArtifactId: z.string().min(1).optional(),
  plateArtifactId: z.string().min(1).optional(),
  plateMode: z.enum(["original-with-protected-text", "layers-text-removed"]),
  status: z.enum(["ready", "reduced", "rejected"]),
  subject: motionSubjectSchema,
  subjects: z.array(motionSubjectSchema),
  typographyRegions: z.array(typographyRegionSchema),
  typography: z.object({ alwaysOnTop: z.literal(true), zIndex: z.number().int() }),
  textPolicy: z.object({ keepOverlayFixed: z.literal(true), preventSubjectTextOverlap: z.literal(true), subjectLayerMode: z.enum(["avoid-typography", "behind-fixed-overlay"]) }),
  requested: z.object({ subject: motionVectorSchema, camera: cameraMotionSchema }),
  final: z.object({ subject: motionVectorSchema, camera: cameraMotionSchema }).nullable(),
  camera: cameraMotionSchema.nullable(),
  collisions: z.array(motionCollisionSchema),
  warnings: z.array(z.string()),
  corrections: z.array(z.object({ subjectScale: z.number().min(0).max(1), cameraScale: z.number().min(0).max(1) })),
  provenance: z.object({ planner: z.literal("SafeMotionPlan"), version: z.literal("2"), collisionPadding: z.number().min(0).max(0.1), noTypographyConfirmed: z.boolean() }),
}).strict();

export type SafeMotionPlan = z.infer<typeof safeMotionPlanSchema>;
