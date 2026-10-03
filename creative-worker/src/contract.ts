// Types-only mirror of hosted/lib/contract (T0) for the worker, whose image ships only creative-worker/src.
// hosted/tests/contract-worker-mirror.test.ts fails when the two drift; change both together.

export const PROVIDER_IDS = ["modal-ltx", "alibaba"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_FRAMES = 121;
export const DEFAULT_FPS = 24;
export const DEFAULT_SEEDS_PLANNED = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;

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
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_EVENT_TYPES = [...JOB_STATUSES, "claimed", "polled"] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

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
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];
export const ACTIVE_PIPELINE_RUN_STATUSES = ["queued", "generating", "finishing", "checking"] as const;

export const TAKE_STAGES = ["generating", "finishing", "checking", "done", "failed"] as const;
export type TakeStage = (typeof TAKE_STAGES)[number];
export const TAKE_VERDICTS = ["pending", "accepted", "rejected"] as const;
export type TakeVerdict = (typeof TAKE_VERDICTS)[number];

export const CHECK_THRESHOLDS = {
  cameraDrift: 12,
  behindTextPercent: 9,
  loopDifference: 5,
  textDrift: 3,
} as const;

export type GenerationInput = {
  idempotencyKey: string;
  modelId: string;
  backgroundUrl: string;
  outputUploadUrl?: string | undefined;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  frames: number;
  fps: number;
  endFrame?: { strength: number } | undefined;
};

export type ProviderPoll =
  | { state: "running" }
  | {
      state: "succeeded";
      resultUrl?: string | undefined;
      uploaded?: boolean | undefined;
      gpuSeconds?: number | undefined;
      costUsd?: number | undefined;
      peakGib?: number | undefined;
      width?: number | undefined;
      height?: number | undefined;
    }
  | { state: "failed"; errorCode: string };

export interface VideoProvider {
  id: ProviderId;
  submit(input: GenerationInput): Promise<{ providerTaskId: string }>;
  poll(providerTaskId: string): Promise<ProviderPoll>;
}

export type MotionStyle = "calm" | "lively";

export type TextAnimation = {
  style: "none" | "fade" | "fade-rise" | "soft-zoom" | "slide-in";
  firstAt: number;
  step: number;
  fade: number;
  rise: number;
  coverFrame: "first" | "last";
};

export type TakeChecks = {
  cameraDrift: number;
  behindTextPercent: number;
  behindTextLine?: number | undefined;
  behindTextAtSeconds?: number | undefined;
  loopDifference: number;
  textDrift?: number | undefined;
  reasons: string[];
};

export type RunSettings = {
  backgroundAssetId: string;
  textAssetId: string | null;
  slideWidth: number;
  slideHeight: number;
  generationWidth: number;
  generationHeight: number;
  frames: number;
  fps: number;
  endFrameStrength: number | null;
  textAnimation: TextAnimation;
};

export type FinishJobOptions = {
  takeId: string;
  backgroundAssetId: string;
  textAssetId: string | null;
  width: number;
  height: number;
  textAnimation?: TextAnimation | undefined;
};

export type FinishJobResult = {
  lines: number;
  textInBy: number;
  step: number;
  colourGains: [number, number, number];
  style: "none" | "fade" | "fade-rise" | "soft-zoom" | "slide-in";
  coverFrame: "first" | "last";
};

export type CheckJobOptions = {
  takeId: string;
  rawAssetId: string;
  finalAssetId: string;
  textAssetId: string | null;
  modelId: string;
  endFramePinned: boolean;
  width: number;
  height: number;
};

export const CHECK_FAILURE_CODES = ["cameraDrift", "behindText", "loop", "textDrift"] as const;
export type CheckFailureCode = (typeof CHECK_FAILURE_CODES)[number];

export type CheckThresholds = {
  cameraDrift: number;
  behindTextPercent: number;
  loopDifference: number;
  textDrift: number;
};

export type CheckJobResult = {
  checks: TakeChecks;
  verdict: "accepted" | "rejected";
  failed: CheckFailureCode[];
  calibrated: boolean;
  thresholds: CheckThresholds;
};

export type PipelineRunRow = {
  id: string;
  owner_user_id: string;
  project_id: string;
  slide_id: string;
  idempotency_key: string;
  fingerprint: string;
  model_id: string;
  provider: ProviderId;
  prompt: string;
  motion_style: MotionStyle;
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
  provider: ProviderId;
  job_id: string | null;
  raw_asset_id: string | null;
  final_asset_id: string | null;
  cover_asset_id: string | null;
  finish_job_id: string | null;
  check_job_id: string | null;
  stage: TakeStage;
  checks: TakeChecks | null;
  verdict: TakeVerdict;
  created_at: string;
  updated_at: string;
};

export type SpendRow = {
  id: string;
  owner_user_id: string;
  provider: string;
  model_id: string;
  job_id: string | null;
  take_id: string | null;
  review_run_id: string | null;
  usd: number;
  gpu_seconds: number | null;
  video_seconds: number | null;
  occurred_at: string;
  created_at: string;
};
