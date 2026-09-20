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

export const safeMotionInputSchema = z.object({
  subject: z.object({ id: z.string().min(1), bounds: normalizedBoundsSchema }),
  typography: z.array(z.object({ id: z.string().min(1), bounds: normalizedBoundsSchema })),
  segmentationBounds: z.array(normalizedBoundsSchema).default([]),
  requested: z.object({ subject: motionVectorSchema, camera: motionVectorSchema }),
  collisionPadding: z.number().min(0).max(0.1).default(0),
});

export type NormalizedBounds = z.infer<typeof normalizedBoundsSchema>;
export type MotionVector = z.infer<typeof motionVectorSchema>;
export type SafeMotionInput = z.infer<typeof safeMotionInputSchema>;

export type MotionCollision = {
  kind: "typography" | "segmentation" | "canvas";
  id: string;
  phase: "initial" | "requested" | "candidate";
  bounds: NormalizedBounds;
};

export type SafeMotionPlan = {
  status: "ready" | "reduced" | "rejected";
  subject: SafeMotionInput["subject"];
  typography: { alwaysOnTop: true; zIndex: number };
  requested: SafeMotionInput["requested"];
  final: SafeMotionInput["requested"] | null;
  collisions: MotionCollision[];
  warnings: string[];
  corrections: { subjectScale: number }[];
};
