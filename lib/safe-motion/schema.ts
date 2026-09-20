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

export const safeMotionInputSchema = z.object({
  sourceArtifactId: z.string().min(1).optional(),
  plateArtifactId: z.string().min(1).optional(),
  plateMode: z.enum(["original-with-protected-text", "layers-text-removed", "inpainted-text-removed"]).default("original-with-protected-text"),
  subject: z.object({ id: z.string().min(1), maskArtifactId: z.string().min(1).optional(), bounds: normalizedBoundsSchema }),
  typography: z.array(z.object({ id: z.string().min(1), bounds: normalizedBoundsSchema })),
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

export type SafeMotionPlan = {
  version: "2";
  sourceArtifactId?: string;
  plateArtifactId?: string;
  plateMode: SafeMotionInput["plateMode"];
  status: "ready" | "reduced" | "rejected";
  subject: SafeMotionInput["subject"];
  subjects: SafeMotionInput["subject"][];
  typographyRegions: SafeMotionInput["typography"];
  typography: { alwaysOnTop: true; zIndex: number };
  textPolicy: { keepOverlayFixed: true; preventSubjectTextOverlap: true; subjectLayerMode: SafeMotionInput["subjectLayerMode"] };
  requested: SafeMotionInput["requested"];
  final: SafeMotionInput["requested"] | null;
  camera: CameraMotion | null;
  collisions: MotionCollision[];
  warnings: string[];
  corrections: { subjectScale: number; cameraScale: number }[];
  provenance: { planner: "SafeMotionPlan"; version: "2"; collisionPadding: number; noTypographyConfirmed: boolean };
};
