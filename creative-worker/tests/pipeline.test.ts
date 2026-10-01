import { describe, expect, it } from "vitest";

import type { CheckFailureCode, PipelineRunRow, TakeChecks, TakeRow } from "../src/contract.js";
import { retryDecision } from "../src/pipeline/policy.js";
import { RunStopped, advanceRun, type PipelineDependencies, type RunPatch } from "../src/pipeline/steps.js";
import { derivedId } from "../src/pipeline/store.js";

const ACTIVE = ["queued", "generating", "finishing", "checking"];

function newRun(overrides: Partial<PipelineRunRow> = {}): PipelineRunRow {
  return {
    id: "run-1", owner_user_id: "owner", project_id: "project", slide_id: "slide", idempotency_key: "key",
    fingerprint: "f".repeat(64), model_id: "ltx-2.5-distilled", provider: "modal-ltx", prompt: "She smiles.",
    motion_style: "calm",
    settings: {
      backgroundAssetId: "bg", textAssetId: "text", slideWidth: 1122, slideHeight: 1402, generationWidth: 768,
      generationHeight: 960, frames: 121, fps: 24, endFrameStrength: 0.6,
      textAnimation: { style: "fade-rise", firstAt: 0.2, step: 0.14, fade: 0.35, rise: 18, coverFrame: "last" },
    },
    allow_fallback: false, seeds_planned: [42, 7], max_attempts: 3, status: "queued", attempt_count: 0,
    budget_reserved_usd: 0, worker_lease_id: "lease", worker_lease_expires_at: null, next_step_at: "", error_code: null,
    reasons: [], created_at: "", updated_at: "",
    ...overrides,
  };
}

const checks = (failed: CheckFailureCode[] = []): TakeChecks => ({
  cameraDrift: failed.includes("cameraDrift") ? 40 : 3,
  behindTextPercent: failed.includes("behindText") ? 12 : 6,
  loopDifference: failed.includes("loop") ? 9 : 2,
  textDrift: failed.includes("textDrift") ? 5 : 2,
  reasons: failed.map((code) => `failed ${code}`),
});

/** In-memory pipeline: provider and vision jobs move only when the test says so. */
function world(run: PipelineRunRow, options: { ready?: boolean; budget?: boolean; fallback?: boolean } = {}) {
  const state = {
    run,
    takes: [] as TakeRow[],
    jobs: new Map<string, { status: string; outputAssetId: string | null; errorCode: string | null }>(),
    vision: new Map<string, { status: string; outputAssetIds: string[]; result: unknown; errorCode: string | null }>(),
    reservations: [] as string[],
    statuses: [] as string[],
    failNextJobCreate: false,
  };
  const deps: PipelineDependencies = {
    takes: {
      list: async () => state.takes.map((take) => ({ ...take })),
      async create(_run, input) {
        const existing = state.takes.find((take) => take.attempt === input.attempt);
        if (existing) return { ...existing };
        const take: TakeRow = {
          id: `take-${input.attempt}`, run_id: run.id, owner_user_id: "owner", project_id: "project", slide_id: "slide",
          attempt: input.attempt, seed: input.seed, model_id: input.modelId, provider: input.provider, job_id: null,
          raw_asset_id: null, final_asset_id: null, cover_asset_id: null, finish_job_id: null, check_job_id: null,
          stage: "generating", checks: null, verdict: "pending", created_at: "", updated_at: "",
        };
        state.takes.push(take);
        return { ...take };
      },
      async update(take, patch) {
        Object.assign(state.takes.find((candidate) => candidate.id === take.id)!, patch);
      },
    },
    jobs: {
      async createProviderJob(_run, take) {
        if (state.failNextJobCreate) {
          state.failNextJobCreate = false;
          throw new Error("worker crashed");
        }
        const id = `job-${take.id}`;
        if (!state.jobs.has(id)) state.jobs.set(id, { status: "queued", outputAssetId: null, errorCode: null });
        return id;
      },
      get: async (id) => ({ ...state.jobs.get(id)! }),
    },
    vision: {
      async createFinish(_run, take) {
        const id = `finish-${take.id}`;
        if (!state.vision.has(id)) state.vision.set(id, { status: "queued", outputAssetIds: [], result: null, errorCode: null });
        return id;
      },
      async createCheck(_run, take) {
        const id = `check-${take.id}`;
        if (!state.vision.has(id)) state.vision.set(id, { status: "queued", outputAssetIds: [], result: null, errorCode: null });
        return id;
      },
      get: async (id) => ({ ...state.vision.get(id)! }),
    },
    async updateRun(current, patch: RunPatch) {
      if (current.worker_lease_id !== state.run.worker_lease_id || !ACTIVE.includes(state.run.status)) return false;
      const { delayMs: _delay, ...fields } = patch;
      state.run = { ...state.run, ...fields };
      state.statuses.push(state.run.status);
      return true;
    },
    providerReady: (modelId) => options.ready ?? modelId !== "missing-model",
    fallback: (current) => (current.allow_fallback && options.fallback !== false ? { modelId: "wan2.7-i2v", provider: "alibaba" } : null),
    async reserveBudget(_run, key) {
      state.reservations.push(key);
      return options.budget ?? true;
    },
    newSeed: () => 1234,
  };
  const step = () => advanceRun({ ...state.run }, deps);
  const latest = () => state.takes.at(-1)!;
  const finishProvider = () => state.jobs.set(latest().job_id!, { status: "completed", outputAssetId: `raw-${latest().id}`, errorCode: null });
  const finishFinish = () => state.vision.set(latest().finish_job_id!, {
    status: "completed", outputAssetIds: [`final-${latest().id}`, `cover-${latest().id}`], result: { lines: 14 }, errorCode: null,
  });
  const finishCheck = (failed: CheckFailureCode[], calibrated = true) => state.vision.set(latest().check_job_id!, {
    status: "completed", outputAssetIds: [], errorCode: null,
    result: { checks: checks(failed), verdict: failed.length ? "rejected" : "accepted", failed, calibrated, thresholds: {} },
  });
  /** Runs one take from start to its check result. */
  const take = async (failed: CheckFailureCode[], calibrated = true) => {
    await step();
    finishProvider();
    await step();
    finishFinish();
    await step();
    finishCheck(failed, calibrated);
    await step();
  };
  return { state, deps, step, take, finishProvider, finishFinish, finishCheck };
}

describe("pipeline run", () => {
  it("goes queued → generating → finishing → checking → completed", async () => {
    const w = world(newRun());
    await w.step();
    expect(w.state.run).toMatchObject({ status: "generating", attempt_count: 1 });
    expect(w.state.takes[0]).toMatchObject({ seed: 42, job_id: "job-take-1", stage: "generating" });
    await w.step();
    expect(w.state.run.status).toBe("generating");
    w.finishProvider();
    await w.step();
    expect(w.state.run.status).toBe("finishing");
    expect(w.state.takes[0]).toMatchObject({ raw_asset_id: "raw-take-1", finish_job_id: "finish-take-1" });
    w.finishFinish();
    await w.step();
    expect(w.state.takes[0]).toMatchObject({ final_asset_id: "final-take-1", cover_asset_id: "cover-take-1", stage: "checking" });
    w.finishCheck([]);
    await w.step();
    expect(w.state.run).toMatchObject({ status: "completed", attempt_count: 1, reasons: [] });
    expect(w.state.takes[0]).toMatchObject({ stage: "done", verdict: "accepted" });
    expect(w.state.reservations).toEqual(["run-1:1"]);
  });

  it("retries a rejected take with the next seed and completes on seed 2", async () => {
    const w = world(newRun());
    await w.take(["behindText"]);
    expect(w.state.run).toMatchObject({ status: "queued", reasons: ["failed behindText"] });
    await w.take([]);
    expect(w.state.run).toMatchObject({ status: "completed", attempt_count: 2 });
    expect(w.state.takes.map((take) => [take.seed, take.verdict])).toEqual([[42, "rejected"], [7, "accepted"]]);
  });

  it("stops with plain reasons when every attempt is rejected", async () => {
    const w = world(newRun());
    await w.take(["cameraDrift"]);
    await w.take(["behindText"]);
    await w.take(["loop"]);
    expect(w.state.run).toMatchObject({ status: "needs_attention", error_code: "takes_rejected", attempt_count: 3 });
    expect(w.state.run.reasons).toEqual(["failed loop", "No take passed the checks."]);
    expect(w.state.takes.map((take) => take.seed)).toEqual([42, 7, 1234]);
    expect(w.state.jobs.size).toBe(3);
  });

  it("asks for a calmer motion after the child moves behind the text twice", async () => {
    const w = world(newRun({ max_attempts: 5 }));
    await w.take(["behindText"]);
    await w.take(["behindText"]);
    expect(w.state.run).toMatchObject({ status: "needs_attention", error_code: "calmer_motion" });
  });

  it("does not retry a text problem a new seed cannot fix, or an uncalibrated model's take", async () => {
    const drift = world(newRun());
    await drift.take(["textDrift"]);
    expect(drift.state.run).toMatchObject({ status: "needs_attention", error_code: "finish_problem", attempt_count: 1 });
    const wan = world(newRun({ model_id: "wan2.7-i2v", provider: "alibaba" }));
    await wan.take(["cameraDrift"], false);
    expect(wan.state.run).toMatchObject({ status: "needs_attention", error_code: "uncalibrated_model", attempt_count: 1 });
  });

  it("refuses a take over budget before any provider call", async () => {
    const w = world(newRun(), { budget: false });
    await w.step();
    expect(w.state.run).toMatchObject({ status: "needs_attention", error_code: "budget_exceeded", attempt_count: 0 });
    expect(w.state.takes).toEqual([]);
    expect(w.state.jobs.size).toBe(0);
  });

  it("stops before paying when the model's provider is not configured", async () => {
    const w = world(newRun(), { ready: false });
    await w.step();
    expect(w.state.run).toMatchObject({ status: "needs_attention", error_code: "provider_not_configured" });
    expect(w.state.reservations).toEqual([]);
  });

  it("stops scheduling after cancel; the in-flight job is left to finish", async () => {
    const w = world(newRun());
    await w.step();
    w.state.run = { ...w.state.run, status: "canceled" };
    w.finishProvider();
    await expect(w.step()).rejects.toBeInstanceOf(RunStopped);
    expect(w.state.vision.size).toBe(1);
    expect(w.state.run.status).toBe("canceled");
  });

  it("resumes after a crash between creating the take and its job, without a second take or job", async () => {
    const w = world(newRun());
    w.state.failNextJobCreate = true;
    await expect(w.step()).rejects.toThrow("worker crashed");
    expect(w.state.run.status).toBe("queued");
    await w.step();
    expect(w.state.takes).toHaveLength(1);
    expect(w.state.takes[0].job_id).toBe("job-take-1");
    expect(w.state.run).toMatchObject({ status: "generating", attempt_count: 1 });
    await w.step();
    expect(w.state.jobs.size).toBe(1);
  });

  it("falls back to the other provider only when the run allows it", async () => {
    const strict = world(newRun());
    await strict.step();
    strict.state.jobs.set("job-take-1", { status: "failed", outputAssetId: null, errorCode: "provider_task_failed" });
    await strict.step();
    expect(strict.state.run).toMatchObject({ status: "needs_attention", error_code: "provider_task_failed", model_id: "ltx-2.5-distilled" });

    const allowed = world(newRun({ allow_fallback: true }));
    await allowed.step();
    allowed.state.jobs.set("job-take-1", { status: "failed", outputAssetId: null, errorCode: "provider_task_failed" });
    await allowed.step();
    expect(allowed.state.run).toMatchObject({ status: "queued", model_id: "wan2.7-i2v", provider: "alibaba" });
    await allowed.step();
    expect(allowed.state.takes[1]).toMatchObject({ attempt: 2, model_id: "wan2.7-i2v", provider: "alibaba" });
  });

  it("marks a finishing failure for attention", async () => {
    const w = world(newRun());
    await w.step();
    w.finishProvider();
    await w.step();
    w.state.vision.set("finish-take-1", { status: "needs_attention", outputAssetIds: [], result: null, errorCode: "finish_inputs_invalid" });
    await w.step();
    expect(w.state.run).toMatchObject({ status: "needs_attention", error_code: "finish_inputs_invalid" });
    expect(w.state.takes[0].stage).toBe("failed");
  });
});

describe("retry policy (P5)", () => {
  it("matches creative-vision's retry_decision", () => {
    expect(retryDecision([["textDrift"]], 2)).toBe("finish_problem");
    expect(retryDecision([["behindText"]], 2)).toBe("new_seed");
    expect(retryDecision([["behindText"], ["behindText", "loop"]], 2)).toBe("calmer_motion");
    expect(retryDecision([["loop"], ["loop"]], 2)).toBe("stop");
    expect(retryDecision([["loop"], ["cameraDrift"]], 0)).toBe("stop");
  });
});

describe("derived ids", () => {
  it("are stable UUIDs per take and operation", () => {
    expect(derivedId("take-1", "finish")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derivedId("take-1", "finish")).toBe(derivedId("take-1", "finish"));
    expect(derivedId("take-1", "check")).not.toBe(derivedId("take-1", "finish"));
  });
});
