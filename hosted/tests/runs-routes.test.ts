import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as choose } from "@/app/api/creations/[id]/slides/[slideId]/choose/route";
import { POST as startRun } from "@/app/api/creations/[id]/slides/[slideId]/runs/route";
import { POST as cancelRun } from "@/app/api/runs/[id]/cancel/route";
import { POST as retryRun } from "@/app/api/runs/[id]/retry/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { requireOwner } from "@/lib/auth";
import { creationViewSchema, runResponseSchema, type PipelineRunRow } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { StudioError } from "@/lib/errors";
import { advanceRun } from "../../creative-worker/src/pipeline/steps";
import { supabasePipeline } from "../../creative-worker/src/pipeline/store";
import { creationsFakeSupabase } from "./creations-fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./creations-fake-supabase").creationsFakeSupabase> | null }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: () => fake.current!.client }));

const ownerId = "00000000-0000-4000-8000-00000000000a";
const creation = contractFixtures.creation;
const potty = creation.document.slides[0];
const salmon = creation.document.slides[1];
const emptySlide = creation.document.slides[3];
const motion = contractFixtures.createRunRequest.motion;

const call = (method: string, body?: unknown, as = "owner") => new Request("https://studio.test", {
  method,
  headers: { Authorization: `Bearer ${as}`, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const slideParams = (slideId: string) => ({ params: Promise.resolve({ id: creation.id, slideId }) });
const runParams = (id: string) => ({ params: Promise.resolve({ id }) });
const tables = () => fake.current!.tables;
const start = async (body: Record<string, unknown> = {}, slideId = potty.id) => startRun(call("POST", {
  idempotencyKey: crypto.randomUUID(), motion, ...body,
}), slideParams(slideId));

beforeEach(() => {
  fake.current = creationsFakeSupabase();
  const document = structuredClone(creation.document);
  document.slides.forEach((slide) => { delete slide.latestRunId; delete slide.chosenTakeId; });
  tables().creative_studio_projects = [{
    id: creation.id, owner_user_id: ownerId, name: document.name, carousel_document: document,
    carousel_revision: 4, updated_at: new Date().toISOString(),
  }];
  tables().creative_studio_assets = [];
  tables().creative_studio_model_acknowledgements = [
    { owner_user_id: ownerId, model_id: "provider:modal-ltx", contract_version: "modal-billing-v1" },
  ];
  vi.mocked(requireOwner).mockImplementation(async (request: Request) => {
    const header = request.headers.get("authorization");
    if (header === "Bearer owner") return { userId: ownerId, email: "owner@test" };
    if (header === "Bearer other") return { userId: "00000000-0000-4000-8000-00000000000b", email: "other@test" };
    throw new StudioError(401, "invalid_token", "Authentication is required.");
  });
});

describe("starting a run", () => {
  it("snapshots the slide, model and settings, and is idempotent on its key", async () => {
    const idempotencyKey = crypto.randomUUID();
    const first = await start({ idempotencyKey });
    expect(first.status).toBe(201);
    const { run } = runResponseSchema.parse(await first.json());
    expect(run).toMatchObject({
      status: "queued", modelId: "ltx-2.5-distilled", provider: "modal-ltx", motionStyle: "calm", attemptCount: 0,
      maxAttempts: 3, takes: [], costUsd: 0,
    });
    expect(run.seedsPlanned).toHaveLength(2);
    expect(tables().creative_studio_pipeline_runs[0].settings).toMatchObject({
      backgroundAssetId: potty.layers.backgroundAssetId, textAssetId: potty.layers.textAssetId,
      slideWidth: 1122, slideHeight: 1402, generationWidth: 768, generationHeight: 960, frames: 121, fps: 24,
      endFrameStrength: 0.6,
    });

    const replay = await start({ idempotencyKey });
    expect(replay.status).toBe(200);
    expect(runResponseSchema.parse(await replay.json()).run.id).toBe(run.id);
    const changed = await start({ idempotencyKey, seeds: 1 });
    expect((await changed.json()).error.code).toBe("idempotency_conflict");
    const second = await start();
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("run_in_progress");
    expect(tables().creative_studio_pipeline_runs).toHaveLength(1);
  });

  it("needs the provider's billing acknowledgement, a background and passing upload checks", async () => {
    tables().creative_studio_model_acknowledgements = [];
    expect((await (await start()).json()).error.code).toBe("billing_acknowledgement_required");
    expect((await (await start({}, emptySlide.id)).json()).error.code).toBe("layers_missing");
    const document = tables().creative_studio_projects[0].carousel_document;
    document.slides[0].checks = contractFixtures.uploadChecksSizeMismatch;
    expect((await (await start()).json()).error.code).toBe("layers_invalid");
  });

  it("runs the creator's Wan choice, pinning the end frame only where the model can", async () => {
    tables().creative_studio_model_acknowledgements.push({ owner_user_id: ownerId, model_id: "provider:alibaba", contract_version: "alibaba-billing-v1" });
    const response = await start({}, salmon.id);
    expect(runResponseSchema.parse(await response.json()).run).toMatchObject({ modelId: "wan2.7-i2v", provider: "alibaba" });
    expect(tables().creative_studio_pipeline_runs[0].settings.endFrameStrength).toBe(0.6);
    await start({ modelId: "wan3-i2v" }, potty.id);
    expect(tables().creative_studio_pipeline_runs[1]).toMatchObject({ model_id: "wan3-i2v", settings: { endFrameStrength: null } });
    expect((await (await start({ modelId: "sora-3" }, emptySlide.id)).json()).error.code).toBe("layers_missing");
    tables().creative_studio_pipeline_runs.pop();
    expect((await (await start({ modelId: "sora-3" }, potty.id)).json()).error.code).toBe("model_unsupported_for_slide");
  });
});

/** Stands in for the worker's claim, the provider job loop and the creative-vision service. */
async function workerStep() {
  const row = tables().creative_studio_pipeline_runs.find((run) => ["queued", "generating", "finishing", "checking"].includes(run.status));
  if (!row) return;
  row.worker_lease_id = "lease";
  const deps = supabasePipeline(fake.current!.client as never, {
    providerReady: () => true, fallback: () => null, reserveBudget: async () => true,
  });
  await advanceRun(structuredClone(row) as PipelineRunRow, deps);
  for (const job of tables().creative_studio_jobs ?? []) {
    if (job.status !== "queued") continue;
    const assetId = crypto.randomUUID();
    tables().creative_studio_assets.push({
      id: assetId, owner_user_id: ownerId, project_id: creation.id, kind: "generated-video",
      object_path: `owners/${ownerId}/projects/${creation.id}/takes/${job.options.takeId}/raw.mp4`,
    });
    Object.assign(job, { status: "completed", output_asset_id: assetId, cost_usd: 0.0301, gpu_seconds: 35.8 });
  }
  for (const job of tables().creative_studio_vision_jobs ?? []) {
    if (job.status !== "queued") continue;
    const takeId = job.options.takeId as string;
    if (job.operation === "finish") {
      const ids = ["final.mp4", "cover.png"].map((name) => {
        const id = crypto.randomUUID();
        tables().creative_studio_assets.push({
          id, owner_user_id: ownerId, project_id: creation.id, kind: "derived-video",
          object_path: `owners/${ownerId}/projects/${creation.id}/takes/${takeId}/${name}`,
        });
        return id;
      });
      Object.assign(job, { status: "completed", output_asset_ids: ids, result: { lines: 14 } });
    } else {
      const attempt = tables().creative_studio_takes.find((take) => take.id === takeId)!.attempt;
      const failed = attempt === 1 ? ["behindText"] : [];
      Object.assign(job, {
        status: "completed",
        result: {
          checks: {
            cameraDrift: 3.2, behindTextPercent: attempt === 1 ? 10.8 : 6.9, loopDifference: 2.6, textDrift: 2.1,
            reasons: attempt === 1 ? ["The child moved behind 'Start with the basics:' at 1.0 s."] : [],
          },
          verdict: failed.length ? "rejected" : "accepted", failed, calibrated: true, thresholds: {},
        },
      });
    }
  }
}

describe("a run on the server", () => {
  it("finishes with no browser open and shows its takes, checks, cost and signed URLs on return", async () => {
    const { run } = runResponseSchema.parse(await (await start()).json());
    for (let step = 0; step < 12; step += 1) await workerStep();

    const reopened = runResponseSchema.parse(await (await getRun(call("GET"), runParams(run.id))).json()).run;
    expect(reopened).toMatchObject({ status: "completed", attemptCount: 2, costUsd: 0.0602 });
    expect(reopened.takes.map((take) => [take.attempt, take.verdict, take.stage])).toEqual([[1, "rejected", "done"], [2, "accepted", "done"]]);
    expect(reopened.takes[0].checks!.reasons).toEqual(["The child moved behind 'Start with the basics:' at 1.0 s."]);
    expect(reopened.takes[1].finalVideoUrl).toMatch(/^https:\/\/storage\.test\/sign\/.*\/final\.mp4\?expires=300$/);
    expect(reopened.takes[1].urlsExpireAt).not.toBeNull();
    expect(tables().creative_studio_jobs).toHaveLength(2);

    const notMine = await getRun(call("GET", undefined, "other"), runParams(run.id));
    expect(notMine.status).toBe(404);

    const chosen = await choose(call("POST", { takeId: reopened.takes[1].id, revision: 4 }), slideParams(potty.id));
    const view = creationViewSchema.parse(await chosen.json());
    expect(view.revision).toBe(5);
    expect(view.document.slides[0]).toMatchObject({ chosenTakeId: reopened.takes[1].id, latestRunId: run.id });
  });

  it("cancels, and lets the creator try another take after it stops", async () => {
    const { run } = runResponseSchema.parse(await (await start()).json());
    expect((await (await retryRun(call("POST"), runParams(run.id))).json()).error.code).toBe("run_in_progress");
    const canceled = runResponseSchema.parse(await (await cancelRun(call("POST"), runParams(run.id))).json()).run;
    expect(canceled.status).toBe("canceled");
    await workerStep();
    expect(tables().creative_studio_takes ?? []).toEqual([]);

    const retried = runResponseSchema.parse(await (await retryRun(call("POST"), runParams(run.id))).json()).run;
    expect(retried).toMatchObject({ status: "queued", maxAttempts: 4 });
  });

  it("won't choose an unfinished take or one from another slide", async () => {
    const { run } = runResponseSchema.parse(await (await start()).json());
    await workerStep();
    const take = tables().creative_studio_takes[0];
    const early = await choose(call("POST", { takeId: take.id, revision: 4 }), slideParams(potty.id));
    expect((await early.json()).error.code).toBe("take_not_ready");
    const elsewhere = await choose(call("POST", { takeId: take.id, revision: 4 }), slideParams(salmon.id));
    expect(elsewhere.status).toBe(404);
    expect(run.id).toBe(take.run_id);
  });
});
