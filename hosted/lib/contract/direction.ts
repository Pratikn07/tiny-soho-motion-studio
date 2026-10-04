import { z } from "zod";

/** A direction run handles at most this many finished slides; it matches the routine's payload limit. */
export const MAX_DIRECTION_SLIDES = 10;
export const FINISHED_SLIDE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_FINISHED_BYTES = 25 * 1024 * 1024;

export const DIRECTION_RUN_STATUSES = ["queued", "running", "completed", "partial", "failed"] as const;
export const directionRunStatusSchema = z.enum(DIRECTION_RUN_STATUSES);
export type DirectionRunStatus = z.infer<typeof directionRunStatusSchema>;

/** `POST /api/creations/:id/slides/:slideId/finished`: ask for a signed upload URL for a finished slide. */
export const finishedUploadRequestSchema = z.object({
  assetId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  mime: z.enum(FINISHED_SLIDE_MIME_TYPES),
  size: z.number().int().positive().max(MAX_FINISHED_BYTES),
});
export type FinishedUploadRequest = z.infer<typeof finishedUploadRequestSchema>;

export const finishedUploadResponseSchema = z.object({
  assetId: z.string().uuid(),
  signedUrl: z.string().url(),
});
export type FinishedUploadResponse = z.infer<typeof finishedUploadResponseSchema>;

/** `PUT /api/creations/:id/slides/:slideId/finished`: record the uploaded finished slide. */
export const finishedFinaliseRequestSchema = z.object({ assetId: z.string().uuid() });
export const finishedFinaliseResponseSchema = z.object({
  assetId: z.string().uuid(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type FinishedFinaliseResponse = z.infer<typeof finishedFinaliseResponseSchema>;

/** `POST /api/creations/:id/direction`: direct these finished slides. */
export const directionStartRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  slides: z
    .array(z.object({ slideId: z.string().uuid(), finishedAssetId: z.string().uuid() }))
    .min(1)
    .max(MAX_DIRECTION_SLIDES)
    .refine((slides) => new Set(slides.map((s) => s.slideId)).size === slides.length, "Each slide appears once."),
});
export type DirectionStartRequest = z.infer<typeof directionStartRequestSchema>;

/**
 * The manifest the routine uploads last (`result.json`). Per slide: whether it was directed, the concept it chose,
 * and the scene prompt for the video model. Unknown fields are ignored so the runtime can add detail.
 */
export const directionResultSchema = z.object({
  version: z.literal(1),
  job: z.string().uuid(),
  slides: z
    .array(z.object({
      n: z.number().int().min(1).max(MAX_DIRECTION_SLIDES),
      slide_id: z.string().uuid(),
      status: z.enum(["completed", "failed"]),
      error: z.string().max(500).optional(),
      concept: z.string().max(60).nullish(),
      scene_prompt: z.string().max(2000).nullish(),
      scene_avoid: z.string().max(2000).nullish(),
      notes: z.string().max(20_000).optional(),
    }))
    .max(MAX_DIRECTION_SLIDES),
});
export type DirectionResult = z.infer<typeof directionResultSchema>;

export const directionSlideViewSchema = z.object({
  slideId: z.string().uuid(),
  status: z.enum(["pending", "completed", "failed"]),
  error: z.string().optional(),
  concept: z.string().optional(),
  scenePrompt: z.string().optional(),
  previewUrl: z.string().url().optional(),
});

export const directionRunViewSchema = z.object({
  id: z.string().uuid(),
  status: directionRunStatusSchema,
  sessionUrl: z.string().url().nullable(),
  errorCode: z.string().nullable(),
  slides: z.array(directionSlideViewSchema),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type DirectionRunView = z.infer<typeof directionRunViewSchema>;
