import { z } from "zod";

import { LAYER_MIME_TYPES, creationDocumentV2Schema, uploadCheckResultSchema } from "./creation";
import { ideaCheckResultSchema, reviewRunViewSchema } from "./review";
import { runViewSchema } from "./runs";

/** Error codes added by the creation v2 endpoints; existing `hosted/lib/errors.ts` codes stay valid. */
export const CREATION_ERROR_CODES = [
  "budget_exceeded",
  "model_unsupported_for_slide",
  "layers_missing",
  "layers_invalid",
  "review_unavailable",
  "run_in_progress",
] as const;

/** Every error response: `{ error: { code, message } }` (`hosted/lib/http.ts`). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(500),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** `GET /api/creations` item. */
export const creationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  updatedAt: z.string().datetime({ offset: true }),
  slideCount: z.number().int().min(0),
  slidesInProgress: z.number().int().min(0),
  coverAssetId: z.string().uuid().nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CreationSummary = z.infer<typeof creationSummarySchema>;

export const creationListResponseSchema = z.object({
  creations: z.array(creationSummarySchema),
});
export type CreationListResponse = z.infer<typeof creationListResponseSchema>;

/** `GET /api/creations/:id`, and the response of create, save, layers PUT and choose. */
export const creationViewSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  document: creationDocumentV2Schema,
});
export type CreationView = z.infer<typeof creationViewSchema>;

/** `POST /api/creations`. */
export const createCreationRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
});
export type CreateCreationRequest = z.infer<typeof createCreationRequestSchema>;

/** `PUT /api/creations/:id`. A stale `revision` returns 409 `carousel_revision_conflict`. */
export const saveCreationRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  document: creationDocumentV2Schema,
});
export type SaveCreationRequest = z.infer<typeof saveCreationRequestSchema>;

const MAX_LAYER_BYTES = 25 * 1024 * 1024;

const layerFileSchema = z.object({
  assetId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_LAYER_BYTES),
});

/** `POST /api/creations/:id/slides/:slideId/layers`: ask for signed upload URLs. The text layer is PNG only. */
export const layerUploadRequestSchema = z.object({
  background: layerFileSchema.extend({ mime: z.enum(LAYER_MIME_TYPES.background) }),
  text: layerFileSchema.extend({ mime: z.enum(LAYER_MIME_TYPES.text) }).optional(),
});
export type LayerUploadRequest = z.infer<typeof layerUploadRequestSchema>;

const signedUploadSchema = z.object({
  assetId: z.string().uuid(),
  signedUrl: z.string().url(),
});

export const layerUploadResponseSchema = z.object({
  uploads: z.object({
    background: signedUploadSchema,
    text: signedUploadSchema.optional(),
  }),
});
export type LayerUploadResponse = z.infer<typeof layerUploadResponseSchema>;

/** `PUT /api/creations/:id/slides/:slideId/layers`: finalise the uploads. `text: null` removes the text layer. */
export const layerFinaliseRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  background: z.object({ assetId: z.string().uuid() }),
  text: z.object({ assetId: z.string().uuid() }).nullable().optional(),
});
export type LayerFinaliseRequest = z.infer<typeof layerFinaliseRequestSchema>;

export const layerFinaliseResponseSchema = z.object({
  creation: creationViewSchema,
  checks: uploadCheckResultSchema,
});
export type LayerFinaliseResponse = z.infer<typeof layerFinaliseResponseSchema>;

/** `POST .../review` and `GET /api/review-runs/:id`. */
export const reviewRunResponseSchema = z.object({ reviewRun: reviewRunViewSchema });
export type ReviewRunResponse = z.infer<typeof reviewRunResponseSchema>;

/** `POST .../idea-check`. */
export const ideaCheckResponseSchema = z.object({
  reviewRunId: z.string().uuid(),
  result: ideaCheckResultSchema,
});
export type IdeaCheckResponse = z.infer<typeof ideaCheckResponseSchema>;

/** `POST .../runs` (201 when created, 200 on replay), `GET /api/runs/:id`, cancel and retry. */
export const runResponseSchema = z.object({ run: runViewSchema });
export type RunResponse = z.infer<typeof runResponseSchema>;
