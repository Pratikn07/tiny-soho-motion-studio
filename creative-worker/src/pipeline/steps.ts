import type { CheckFailureCode, CheckJobResult, PipelineRunRow, PipelineRunStatus, TakeRow } from "../contract.js";
import type { RoutedModel } from "../router.js";
import { STOP_REASONS, retryDecision } from "./policy.js";

export type JobState = { status: string; outputAssetId: string | null; errorCode: string | null };
export type VisionState = { status: string; outputAssetIds: string[]; result: unknown; errorCode: string | null };

export type RunPatch = Partial<Pick<
  PipelineRunRow,
  "status" | "attempt_count" | "seeds_planned" | "model_id" | "provider" | "error_code" | "reasons"
>> & { delayMs?: number };

/** Everything a step needs, injected so the state machine is testable without Supabase or providers. */
export type PipelineDependencies = {
  takes: {
    list(runId: string): Promise<TakeRow[]>;
    /** Idempotent on (run, attempt): returns the existing take after a crash. */
    create(run: PipelineRunRow, input: { attempt: number; seed: number } & RoutedModel): Promise<TakeRow>;
    update(take: TakeRow, patch: Partial<TakeRow>): Promise<void>;
  };
  jobs: {
    /** Idempotent on the take id. */
    createProviderJob(run: PipelineRunRow, take: TakeRow): Promise<string>;
    get(jobId: string): Promise<JobState>;
  };
  vision: {
    /** Idempotent per take and operation. */
    createFinish(run: PipelineRunRow, take: TakeRow): Promise<string>;
    createCheck(run: PipelineRunRow, take: TakeRow): Promise<string>;
    get(jobId: string): Promise<VisionState>;
  };
  /** Lease- and status-guarded; false when the run was canceled or its lease moved on. */
  updateRun(run: PipelineRunRow, patch: RunPatch): Promise<boolean>;
  providerReady(modelId: string): boolean;
  fallback(run: PipelineRunRow): RoutedModel | null;
  /** Reserves the estimated cost of one take before any provider call (O1); idempotent per key. */
  reserveBudget(run: PipelineRunRow, key: string, modelId: string): Promise<boolean>;
  /** Records a finished provider job's cost in the ledger and settles its reservation; idempotent. */
  settleSpend(jobId: string): Promise<void>;
  newSeed(): number;
};

const ACTIVE_JOB = ["queued", "submitting", "submitted", "running", "downloading"];
const ACTIVE_VISION = ["queued", "running"];
const POLL_MS = 10_000;

export class RunStopped extends Error {
  constructor() {
    super("pipeline_run_stopped");
    this.name = "RunStopped";
  }
}

async function update(deps: PipelineDependencies, run: PipelineRunRow, patch: RunPatch) {
  if (!(await deps.updateRun(run, patch))) throw new RunStopped();
}

const attention = (deps: PipelineDependencies, run: PipelineRunRow, errorCode: string, reasons: string[]) => (
  update(deps, run, { status: "needs_attention", error_code: errorCode, reasons })
);

const checkResult = (value: unknown): CheckJobResult | null => {
  const result = value as Partial<CheckJobResult> | null;
  return result && result.checks && (result.verdict === "accepted" || result.verdict === "rejected") && Array.isArray(result.failed)
    ? (result as CheckJobResult)
    : null;
};

async function startAttempt(run: PipelineRunRow, deps: PipelineDependencies) {
  if (run.attempt_count >= run.max_attempts) {
    return attention(deps, run, "attempts_used", run.reasons.length ? run.reasons : [STOP_REASONS.stop]);
  }
  if (!deps.providerReady(run.model_id)) {
    return attention(deps, run, "provider_not_configured", ["The video service for this model isn't set up yet. Nothing was charged."]);
  }
  const attempt = run.attempt_count + 1;
  const seeds = [...run.seeds_planned];
  while (seeds.length < attempt) seeds.push(deps.newSeed());
  if (!(await deps.reserveBudget(run, `${run.id}:${attempt}`, run.model_id))) {
    return attention(deps, run, "budget_exceeded", ["This take would go over this month's budget. Nothing was charged."]);
  }
  const take = await deps.takes.create(run, { attempt, seed: seeds[attempt - 1], modelId: run.model_id, provider: run.provider });
  const jobId = await deps.jobs.createProviderJob(run, take);
  await deps.takes.update(take, { job_id: jobId });
  await update(deps, run, { status: "generating", attempt_count: attempt, seeds_planned: seeds, error_code: null, delayMs: POLL_MS });
}

async function stepGenerating(run: PipelineRunRow, take: TakeRow, deps: PipelineDependencies) {
  if (!take.job_id) {
    const jobId = await deps.jobs.createProviderJob(run, take);
    await deps.takes.update(take, { job_id: jobId });
    return update(deps, run, { status: "generating", attempt_count: Math.max(run.attempt_count, take.attempt), delayMs: POLL_MS });
  }
  const job = await deps.jobs.get(take.job_id);
  if (ACTIVE_JOB.includes(job.status)) return update(deps, run, { status: "generating", delayMs: POLL_MS });
  await deps.settleSpend(take.job_id);
  if (job.status === "completed" && job.outputAssetId) {
    await deps.takes.update(take, { raw_asset_id: job.outputAssetId, stage: "finishing" });
    const finishJobId = await deps.vision.createFinish(run, { ...take, raw_asset_id: job.outputAssetId });
    await deps.takes.update(take, { finish_job_id: finishJobId });
    return update(deps, run, { status: "finishing", delayMs: POLL_MS });
  }
  await deps.takes.update(take, { stage: "failed" });
  const fallback = deps.fallback(run);
  if (fallback && fallback.modelId !== run.model_id && deps.providerReady(fallback.modelId)) {
    return update(deps, run, { status: "queued", model_id: fallback.modelId, provider: fallback.provider, delayMs: 0 });
  }
  return attention(deps, run, job.errorCode ?? "provider_failed", ["The video service couldn't make this take."]);
}

async function stepFinishing(run: PipelineRunRow, take: TakeRow, deps: PipelineDependencies) {
  if (!take.finish_job_id) {
    const finishJobId = await deps.vision.createFinish(run, take);
    await deps.takes.update(take, { finish_job_id: finishJobId });
    return update(deps, run, { status: "finishing", delayMs: POLL_MS });
  }
  const job = await deps.vision.get(take.finish_job_id);
  if (ACTIVE_VISION.includes(job.status)) return update(deps, run, { status: "finishing", delayMs: POLL_MS });
  const [finalAssetId, coverAssetId] = job.outputAssetIds;
  if (job.status !== "completed" || !finalAssetId) {
    await deps.takes.update(take, { stage: "failed" });
    return attention(deps, run, job.errorCode ?? "finish_failed", ["Adding your text to this take didn't work."]);
  }
  const finished = { ...take, final_asset_id: finalAssetId, cover_asset_id: coverAssetId ?? null };
  await deps.takes.update(take, { final_asset_id: finalAssetId, cover_asset_id: coverAssetId ?? null, stage: "checking" });
  const checkJobId = await deps.vision.createCheck(run, finished);
  await deps.takes.update(take, { check_job_id: checkJobId });
  return update(deps, run, { status: "checking", delayMs: POLL_MS });
}

async function stepChecking(run: PipelineRunRow, take: TakeRow, takes: TakeRow[], deps: PipelineDependencies) {
  if (!take.check_job_id) {
    const checkJobId = await deps.vision.createCheck(run, take);
    await deps.takes.update(take, { check_job_id: checkJobId });
    return update(deps, run, { status: "checking", delayMs: POLL_MS });
  }
  const job = await deps.vision.get(take.check_job_id);
  if (ACTIVE_VISION.includes(job.status)) return update(deps, run, { status: "checking", delayMs: POLL_MS });
  const result = job.status === "completed" ? checkResult(job.result) : null;
  if (!result) {
    await deps.takes.update(take, { stage: "failed" });
    return attention(deps, run, job.errorCode ?? "check_failed", ["This take couldn't be checked."]);
  }
  await deps.takes.update(take, { checks: result.checks, verdict: result.verdict, stage: "done" });
  const decided = takes.map((candidate) => (
    candidate.id === take.id ? { ...candidate, checks: result.checks, verdict: result.verdict, stage: "done" as const } : candidate
  ));
  return afterTake(run, decided, deps, result);
}

/** A take was checked: complete the run, start the next seed, or stop with plain reasons. */
async function afterTake(run: PipelineRunRow, takes: TakeRow[], deps: PipelineDependencies, latestResult?: CheckJobResult) {
  const latest = takes.at(-1)!;
  if (latest.verdict === "accepted") return update(deps, run, { status: "completed", error_code: null, reasons: [] });
  const result = latestResult ?? (latest.check_job_id ? checkResult((await deps.vision.get(latest.check_job_id)).result) : null);
  const reasons = latest.checks?.reasons ?? [];
  if (result && !result.calibrated) return attention(deps, run, "uncalibrated_model", [...reasons, STOP_REASONS.uncalibrated]);
  const rejections: CheckFailureCode[][] = [];
  for (const take of takes.filter((candidate) => candidate.verdict === "rejected")) {
    if (take.id === latest.id && result) rejections.push(result.failed);
    else if (take.check_job_id) rejections.push(checkResult((await deps.vision.get(take.check_job_id)).result)?.failed ?? []);
  }
  const decision = retryDecision(rejections, run.max_attempts - Math.max(run.attempt_count, latest.attempt));
  if (decision === "new_seed") return update(deps, run, { status: "queued", reasons, delayMs: 0 });
  return attention(deps, run, decision === "stop" ? "takes_rejected" : decision, [...reasons, STOP_REASONS[decision]]);
}

const STATUS_OF_STAGE: Partial<Record<TakeRow["stage"], PipelineRunStatus>> = {
  generating: "generating",
  finishing: "finishing",
  checking: "checking",
};

/** Advances a claimed run by one step. Safe to repeat after a crash: every create is idempotent. */
export async function advanceRun(run: PipelineRunRow, deps: PipelineDependencies) {
  const takes = await deps.takes.list(run.id);
  const latest = takes.at(-1);
  if (latest && STATUS_OF_STAGE[latest.stage]) {
    if (latest.stage === "generating") return stepGenerating(run, latest, deps);
    if (latest.stage === "finishing") return stepFinishing(run, latest, deps);
    return stepChecking(run, latest, takes, deps);
  }
  if (run.status === "queued" || !latest) return startAttempt(run, deps);
  if (latest.stage === "done") return afterTake(run, takes, deps);
  return attention(deps, run, run.error_code ?? "take_failed", run.reasons.length ? run.reasons : ["This take failed."]);
}
