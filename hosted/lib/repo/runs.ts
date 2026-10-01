import { createHash, randomInt } from "node:crypto";

import { fitForSlide } from "@/lib/catalog/fit";
import { getCatalogModel } from "@/lib/catalog/models";
import { isBillingAcknowledged } from "@/lib/catalog/view";
import {
  ACTIVE_PIPELINE_RUN_STATUSES,
  DEFAULT_FPS,
  DEFAULT_FRAMES,
  DEFAULT_MAX_ATTEMPTS,
  END_FRAME_STRENGTH,
  runViewSchema,
  type CreateRunRequest,
  type CreationDocumentV2,
  type PipelineRunRow,
  type RunSettings,
  type RunView,
  type SlideV2,
  type TakeRow,
} from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import type { StoredModelAcknowledgement } from "@/lib/model-acknowledgements";
import type { Owner } from "@/lib/types";

type Client = { from: (table: string) => any; storage: { from: (bucket: string) => any } };
type Result<T> = { data: T | null; error: { code?: string } | null };

const SIGNED_URL_SECONDS = 300;
const MAX_ATTEMPTS_LIMIT = 10;

const unavailable = () => new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
const value = <T>(result: Result<T>) => {
  if (result.error) throw unavailable();
  return result.data;
};
const sha256 = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

export type PlannedRun = Omit<
  PipelineRunRow,
  "id" | "owner_user_id" | "status" | "attempt_count" | "budget_reserved_usd" | "worker_lease_id"
  | "worker_lease_expires_at" | "next_step_at" | "error_code" | "reasons" | "created_at" | "updated_at"
>;

/** Checks that the slide can be generated with the chosen model and snapshots everything the run needs. */
export function planRun(input: {
  projectId: string;
  document: CreationDocumentV2;
  slide: SlideV2;
  request: Required<Pick<CreateRunRequest, "seeds" | "allowFallback">> & CreateRunRequest;
  acknowledgements: readonly StoredModelAcknowledgement[];
  newSeed?: () => number;
}): PlannedRun {
  const { slide, document, request } = input;
  if (!slide.layers.backgroundAssetId || slide.width === null || slide.height === null) {
    throw new StudioError(400, "layers_missing", "Upload this slide's background first.");
  }
  if (!slide.checks?.ok || !slide.checks.generationSize) {
    throw new StudioError(400, "layers_invalid", "Fix the upload problems on this slide first.");
  }
  const modelId = request.modelId ?? slide.modelId ?? document.defaults.modelId;
  const model = getCatalogModel(modelId);
  if (!model?.enabled) throw new StudioError(400, "model_unsupported_for_slide", "Choose a model from the list.");
  const fit = fitForSlide(model, slide);
  if (!fit.ok) throw new StudioError(400, "model_unsupported_for_slide", fit.reason ?? "This model can't make this slide.");
  if (!isBillingAcknowledged(model, input.acknowledgements)) {
    throw new StudioError(400, "billing_acknowledgement_required", "Confirm this video service's billing before the first take.");
  }
  const motionStyle = request.motion.motionStyle ?? document.defaults.motionStyle;
  const settings: RunSettings = {
    backgroundAssetId: slide.layers.backgroundAssetId,
    textAssetId: slide.layers.textAssetId,
    slideWidth: slide.width,
    slideHeight: slide.height,
    generationWidth: slide.checks.generationSize.width,
    generationHeight: slide.checks.generationSize.height,
    frames: DEFAULT_FRAMES,
    fps: DEFAULT_FPS,
    endFrameStrength: model.supports.endFrame ? END_FRAME_STRENGTH[motionStyle] : null,
    textAnimation: request.textAnimation ?? slide.textAnimation ?? document.defaults.textAnimation,
  };
  const newSeed = input.newSeed ?? (() => randomInt(0, 2_147_483_647));
  const seeds = new Set<number>();
  while (seeds.size < request.seeds) seeds.add(newSeed());
  return {
    project_id: input.projectId,
    slide_id: slide.id,
    idempotency_key: request.idempotencyKey,
    fingerprint: sha256({ slide: slide.id, modelId, prompt: request.motion.prompt, motionStyle, seeds: request.seeds,
      allowFallback: request.allowFallback, settings }),
    model_id: model.id,
    provider: model.provider,
    prompt: request.motion.prompt,
    motion_style: motionStyle,
    settings,
    allow_fallback: request.allowFallback,
    seeds_planned: [...seeds],
    max_attempts: Math.max(DEFAULT_MAX_ATTEMPTS, request.seeds),
  };
}

export class RunsRepository {
  constructor(
    private readonly client: Client,
    private readonly owner: Owner,
  ) {}

  async findByKey(projectId: string, idempotencyKey: string) {
    return value(await this.client.from("creative_studio_pipeline_runs").select("*")
      .eq("owner_user_id", this.owner.userId).eq("project_id", projectId).eq("idempotency_key", idempotencyKey)
      .maybeSingle() as Result<PipelineRunRow>);
  }

  /** Idempotent on the request's key: a refresh or double-click returns the same run (`created: false`). */
  async create(plan: PlannedRun): Promise<{ run: PipelineRunRow; created: boolean }> {
    const replay = (existing: PipelineRunRow) => {
      if (existing.fingerprint !== plan.fingerprint) {
        throw new StudioError(409, "idempotency_conflict", "This request key belongs to a different generation request.");
      }
      return { run: existing, created: false };
    };
    const existing = await this.findByKey(plan.project_id, plan.idempotency_key);
    if (existing) return replay(existing);
    const inserted = await this.client.from("creative_studio_pipeline_runs")
      .insert({ ...plan, owner_user_id: this.owner.userId, status: "queued" })
      .select("*").single() as Result<PipelineRunRow>;
    if (!inserted.error && inserted.data) return { run: inserted.data, created: true };
    if (inserted.error?.code !== "23505") throw unavailable();
    const raced = await this.findByKey(plan.project_id, plan.idempotency_key);
    if (raced) return replay(raced);
    throw new StudioError(409, "run_in_progress", "This slide is already being generated. Wait for it or cancel it first.");
  }

  async get(runId: string): Promise<PipelineRunRow | null> {
    return value(await this.client.from("creative_studio_pipeline_runs").select("*")
      .eq("id", runId).eq("owner_user_id", this.owner.userId).maybeSingle() as Result<PipelineRunRow>);
  }

  async require(runId: string) {
    const run = await this.get(runId);
    if (!run) throw new StudioError(404, "run_not_found", "This run was not found.");
    return run;
  }

  /** Stops scheduling new work; a provider job already running finishes and is recorded. */
  async cancel(run: PipelineRunRow): Promise<PipelineRunRow> {
    if (!(ACTIVE_PIPELINE_RUN_STATUSES as readonly string[]).includes(run.status)) return run;
    const updated = value(await this.client.from("creative_studio_pipeline_runs")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", run.id).eq("owner_user_id", this.owner.userId).in("status", [...ACTIVE_PIPELINE_RUN_STATUSES])
      .select("*").maybeSingle() as Result<PipelineRunRow>);
    return updated ?? (await this.require(run.id));
  }

  /** "Try another take": one more paid attempt on a run that has stopped. */
  async retry(run: PipelineRunRow): Promise<PipelineRunRow> {
    if ((ACTIVE_PIPELINE_RUN_STATUSES as readonly string[]).includes(run.status)) {
      throw new StudioError(409, "run_in_progress", "This slide is still being generated.");
    }
    const maxAttempts = Math.max(run.max_attempts, run.attempt_count) + 1;
    if (maxAttempts > MAX_ATTEMPTS_LIMIT) {
      throw new StudioError(400, "attempts_limit", "This slide has had the most takes one run allows. Start a new run.");
    }
    const updated = await this.client.from("creative_studio_pipeline_runs")
      .update({
        status: "queued", max_attempts: maxAttempts, error_code: null, reasons: [],
        next_step_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq("id", run.id).eq("owner_user_id", this.owner.userId).eq("status", run.status)
      .select("*").maybeSingle() as Result<PipelineRunRow>;
    if (updated.error?.code === "23505") {
      throw new StudioError(409, "run_in_progress", "Another run for this slide is in progress.");
    }
    return value(updated) ?? (await this.require(run.id));
  }

  async takes(runId: string): Promise<TakeRow[]> {
    return value(await this.client.from("creative_studio_takes").select("*")
      .eq("run_id", runId).eq("owner_user_id", this.owner.userId).order("attempt", { ascending: true }) as Result<TakeRow[]>) ?? [];
  }

  async take(takeId: string): Promise<TakeRow | null> {
    return value(await this.client.from("creative_studio_takes").select("*")
      .eq("id", takeId).eq("owner_user_id", this.owner.userId).maybeSingle() as Result<TakeRow>);
  }

  /** The run with its takes, check results, cost so far and 300 s signed URLs for each take's videos. */
  async view(run: PipelineRunRow, now = Date.now()): Promise<RunView> {
    const takes = await this.takes(run.id);
    const jobIds = takes.flatMap((take) => (take.job_id ? [take.job_id] : []));
    const jobs = jobIds.length ? value(await this.client.from("creative_studio_jobs").select("id,cost_usd,gpu_seconds")
      .eq("owner_user_id", this.owner.userId).in("id", jobIds) as Result<Array<{ id: string; cost_usd: number | null; gpu_seconds: number | null }>>) ?? [] : [];
    const assetIds = takes.flatMap((take) => [take.raw_asset_id, take.final_asset_id, take.cover_asset_id]).filter((id): id is string => Boolean(id));
    const assets = assetIds.length ? value(await this.client.from("creative_studio_assets").select("id,object_path")
      .eq("owner_user_id", this.owner.userId).in("id", assetIds) as Result<Array<{ id: string; object_path: string }>>) ?? [] : [];
    const urls = new Map<string, string>();
    await Promise.all(assets.map(async (asset) => {
      const signed = await this.client.storage.from("creative-studio").createSignedUrl(asset.object_path, SIGNED_URL_SECONDS);
      if (!signed.error && signed.data?.signedUrl) urls.set(asset.id, signed.data.signedUrl);
    }));
    const url = (id: string | null) => (id ? urls.get(id) ?? null : null);
    const costByJob = new Map(jobs.map((job) => [job.id, job]));
    const expires = new Date(now + SIGNED_URL_SECONDS * 1000).toISOString();
    return runViewSchema.parse({
      id: run.id,
      projectId: run.project_id,
      slideId: run.slide_id,
      status: run.status,
      modelId: run.model_id,
      provider: run.provider,
      motionStyle: run.motion_style,
      prompt: run.prompt,
      allowFallback: run.allow_fallback,
      seedsPlanned: run.seeds_planned,
      attemptCount: run.attempt_count,
      maxAttempts: run.max_attempts,
      costUsd: jobs.reduce((sum, job) => sum + Number(job.cost_usd ?? 0), 0),
      errorCode: run.error_code,
      reasons: run.reasons ?? [],
      takes: takes.map((take) => {
        const job = take.job_id ? costByJob.get(take.job_id) : undefined;
        const raw = url(take.raw_asset_id);
        const final = url(take.final_asset_id);
        const cover = url(take.cover_asset_id);
        return {
          id: take.id,
          attempt: take.attempt,
          seed: take.seed,
          modelId: take.model_id,
          provider: take.provider,
          stage: take.stage,
          verdict: take.verdict,
          checks: take.checks,
          rawVideoUrl: raw,
          finalVideoUrl: final,
          coverUrl: cover,
          urlsExpireAt: raw || final || cover ? expires : null,
          costUsd: job?.cost_usd === null || job?.cost_usd === undefined ? null : Number(job.cost_usd),
          gpuSeconds: job?.gpu_seconds === null || job?.gpu_seconds === undefined ? null : Number(job.gpu_seconds),
          createdAt: new Date(take.created_at).toISOString(),
        };
      }),
      createdAt: new Date(run.created_at).toISOString(),
      updatedAt: new Date(run.updated_at).toISOString(),
    });
  }
}
