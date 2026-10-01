import { z } from "zod";

import { takeChecksSchema, takeVerdictSchema } from "./checks";
import { motionStyleSchema, slideMotionSchema, textAnimationSchema } from "./creation";
import { providerIdSchema } from "./provider";

/**
 * queued → generating → finishing → checking → completed
 *                     ↘ (take rejected, attempts left) → generating
 * any → needs_attention | failed | canceled
 */
export const PIPELINE_RUN_STATUSES = [
  "queued",
  "generating",
  "finishing",
  "checking",
  "completed",
  "needs_attention",
  "failed",
  "canceled",
] as const;
export const ACTIVE_PIPELINE_RUN_STATUSES = ["queued", "generating", "finishing", "checking"] as const;
export const pipelineRunStatusSchema = z.enum(PIPELINE_RUN_STATUSES);
export type PipelineRunStatus = z.infer<typeof pipelineRunStatusSchema>;

/** Where a single take is: its provider job, then finishing, then checks. */
export const TAKE_STAGES = ["generating", "finishing", "checking", "done", "failed"] as const;
export const takeStageSchema = z.enum(TAKE_STAGES);
export type TakeStage = z.infer<typeof takeStageSchema>;

/** Provider job states (`creative_studio_jobs.status`), unchanged from `hosted/lib/jobs.ts`. */
export const JOB_STATUSES = [
  "queued",
  "submitting",
  "submitted",
  "running",
  "downloading",
  "completed",
  "failed",
  "needs_attention",
  "canceled",
] as const;
/** Every job status is a valid `creative_studio_job_events.event_type`, plus the worker's own events. */
export const JOB_EVENT_TYPES = [...JOB_STATUSES, "claimed", "polled"] as const;

/** `RunView.errorCode` when a run stops for attention; `reasons` carries the plain-language explanation. */
export const RUN_ERROR_CODES = [
  "takes_rejected",
  "calmer_motion",
  "finish_problem",
  "uncalibrated_model",
  "attempts_used",
  "budget_exceeded",
  "provider_not_configured",
  "provider_failed",
  "finish_failed",
  "check_failed",
] as const;

export const DEFAULT_SEEDS_PLANNED = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Snapshot taken when a run starts (`creative_studio_pipeline_runs.settings`), so later edits do not change it. */
export const runSettingsSchema = z.object({
  backgroundAssetId: z.string().uuid(),
  textAssetId: z.string().uuid().nullable(),
  slideWidth: z.number().int().positive(),
  slideHeight: z.number().int().positive(),
  generationWidth: z.number().int().positive(),
  generationHeight: z.number().int().positive(),
  frames: z.number().int().positive(),
  fps: z.number().int().positive(),
  endFrameStrength: z.number().min(0).max(1).nullable(),
  textAnimation: textAnimationSchema,
});
export type RunSettings = z.infer<typeof runSettingsSchema>;

/** `POST /api/creations/:id/slides/:slideId/runs`. Missing fields fall back to the slide, then the creation defaults. */
export const createRunRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  modelId: z.string().trim().min(1).max(120).optional(),
  motion: slideMotionSchema,
  seeds: z.number().int().min(1).max(3).default(DEFAULT_SEEDS_PLANNED),
  allowFallback: z.boolean().default(false),
  textAnimation: textAnimationSchema.optional(),
});
export type CreateRunRequest = z.input<typeof createRunRequestSchema>;

/** `POST /api/creations/:id/slides/:slideId/choose`. */
export const chooseTakeRequestSchema = z.object({
  takeId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
export type ChooseTakeRequest = z.infer<typeof chooseTakeRequestSchema>;

const timestamp = z.string().datetime({ offset: true });

export const takeViewSchema = z
  .object({
    id: z.string().uuid(),
    attempt: z.number().int().positive(),
    seed: z.number().int().min(0),
    modelId: z.string().trim().min(1).max(120),
    provider: providerIdSchema,
    stage: takeStageSchema,
    verdict: takeVerdictSchema,
    checks: takeChecksSchema.nullable(),
    rawVideoUrl: z.string().url().nullable(),
    finalVideoUrl: z.string().url().nullable(),
    coverUrl: z.string().url().nullable(),
    urlsExpireAt: timestamp.nullable(),
    costUsd: z.number().nonnegative().nullable(),
    gpuSeconds: z.number().nonnegative().nullable(),
    createdAt: timestamp,
  })
  .refine((take) => take.verdict === "pending" || take.checks !== null, "A decided take has check results.")
  .refine(
    (take) => take.urlsExpireAt !== null || (!take.rawVideoUrl && !take.finalVideoUrl && !take.coverUrl),
    "Signed URLs carry their expiry time.",
  );
export type TakeView = z.infer<typeof takeViewSchema>;

/** `GET /api/runs/:id`, and the body of every run mutation response. Signed URLs live 300 s. */
export const runViewSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slideId: z.string().uuid(),
    status: pipelineRunStatusSchema,
    modelId: z.string().trim().min(1).max(120),
    provider: providerIdSchema,
    motionStyle: motionStyleSchema,
    prompt: z.string().trim().min(1).max(5000),
    allowFallback: z.boolean(),
    seedsPlanned: z.array(z.number().int().min(0)).min(1),
    attemptCount: z.number().int().min(0),
    maxAttempts: z.number().int().positive(),
    costUsd: z.number().nonnegative(),
    errorCode: z.string().max(120).nullable(),
    reasons: z.array(z.string().trim().min(1).max(300)).max(20),
    takes: z.array(takeViewSchema),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine((run) => run.attemptCount <= run.maxAttempts, "attemptCount never exceeds maxAttempts.")
  .refine(
    (run) => run.status !== "completed" || run.takes.some((take) => take.verdict === "accepted"),
    "A completed run has an accepted take.",
  );
export type RunView = z.infer<typeof runViewSchema>;

/** Database rows (snake_case, service role only). The worker keeps a types-only mirror in `creative-worker/src/contract.ts`. */
export type PipelineRunRow = {
  id: string;
  owner_user_id: string;
  project_id: string;
  slide_id: string;
  idempotency_key: string;
  fingerprint: string;
  model_id: string;
  provider: z.infer<typeof providerIdSchema>;
  prompt: string;
  motion_style: z.infer<typeof motionStyleSchema>;
  settings: RunSettings;
  allow_fallback: boolean;
  seeds_planned: number[];
  max_attempts: number;
  status: PipelineRunStatus;
  attempt_count: number;
  budget_reserved_usd: number;
  worker_lease_id: string | null;
  worker_lease_expires_at: string | null;
  next_step_at: string;
  error_code: string | null;
  reasons: string[];
  created_at: string;
  updated_at: string;
};

export type TakeRow = {
  id: string;
  run_id: string;
  owner_user_id: string;
  project_id: string;
  slide_id: string;
  attempt: number;
  seed: number;
  model_id: string;
  provider: z.infer<typeof providerIdSchema>;
  job_id: string | null;
  raw_asset_id: string | null;
  final_asset_id: string | null;
  cover_asset_id: string | null;
  finish_job_id: string | null;
  check_job_id: string | null;
  stage: TakeStage;
  checks: z.infer<typeof takeChecksSchema> | null;
  verdict: z.infer<typeof takeVerdictSchema>;
  created_at: string;
  updated_at: string;
};
