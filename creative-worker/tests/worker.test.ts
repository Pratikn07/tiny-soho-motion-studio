import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JOB_EVENT_TYPES } from "../src/contract.js";
import { JOB_UPDATE_STATUSES } from "../src/process-job.js";
import { generatedVideoPath, jobLeasePatch, runWorkerTick, skippedWork, workerConfig, type WorkerConfig } from "../src/worker.js";
import { fakeSupabase } from "./fake-supabase.js";

const owner = "00000000-0000-4000-8000-000000000001";
const project = "3f1c2a4e-8b7d-4c1a-9e2f-5a6b7c8d9e01";
const jobId = "44444444-4444-4444-8444-444444444444";
const video = Buffer.from("fake mp4 bytes");
const config: WorkerConfig = {
  supabaseUrl: "https://example.supabase.co",
  serviceRoleKey: "service-role",
  alibaba: { apiKey: "dashscope", workspaceId: "workspace" },
};

const queuedJob = (overrides: Record<string, unknown> = {}) => ({
  id: jobId,
  owner_user_id: owner,
  project_id: project,
  provider: "alibaba",
  model_id: "wan2.7-i2v",
  task: "image-to-video",
  prompt: "She smiles.",
  options: { duration: 5, resolution: "720P" },
  status: "queued",
  provider_task_id: null,
  submit_attempt_id: null,
  output_asset_id: null,
  error_code: null,
  worker_lease_id: null,
  worker_lease_expires_at: null,
  next_poll_at: new Date(Date.now() - 1_000).toISOString(),
  attempt_count: 0,
  ...overrides,
});

const world = (job = queuedJob()) => fakeSupabase({
  creative_studio_jobs: [job],
  creative_studio_job_events: [],
  creative_studio_job_media: [{ job_id: jobId, owner_user_id: owner, asset_id: "a1", role: "first_frame", ordinal: 1 }],
  creative_studio_assets: [{ id: "a1", owner_user_id: owner, object_path: "owners/x/slide.png", mime_type: "image/png", name: "slide.png" }],
});

/** DashScope stand-in: submit returns task-1, polls follow `statuses`, the result URL serves an MP4. */
function dashscope(statuses: string[], hooks: { onSubmit?: () => void; onPoll?: () => void } = {}) {
  const calls = { submit: 0, poll: 0, download: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      calls.submit += 1;
      hooks.onSubmit?.();
      return Response.json({ output: { task_id: "task-1" } });
    }
    if (url.includes("/tasks/")) {
      hooks.onPoll?.();
      const status = statuses[Math.min(calls.poll, statuses.length - 1)];
      calls.poll += 1;
      return Response.json({ output: { task_status: status, video_url: "https://result.example/video.mp4" } });
    }
    calls.download += 1;
    return new Response(video, { headers: { "content-type": "video/mp4", "content-length": String(video.byteLength) } });
  }));
  return calls;
}

const events = (tables: Record<string, any[]>) => tables.creative_studio_job_events.map((event) => event.event_type);
const job = (tables: Record<string, any[]>) => tables.creative_studio_jobs[0];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("job statuses and events", () => {
  it("writes only statuses the event_type constraint accepts", () => {
    const directory = new URL("../../supabase/migrations/", import.meta.url);
    const file = readdirSync(directory).find((name) => name.endsWith("_creation_v2.sql"))!;
    const sql = readFileSync(new URL(file, directory), "utf8");
    const allowed = [...sql.match(/event_type in \(([^)]*)\)/s)![1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(allowed.sort()).toEqual([...JOB_EVENT_TYPES].sort());
    for (const status of JOB_UPDATE_STATUSES) expect(allowed).toContain(status);
  });

  it("keeps the lease while submitting and ingesting, and releases it otherwise", () => {
    expect(jobLeasePatch("submitting")).toEqual({});
    expect(jobLeasePatch("downloading")).toEqual({});
    expect(jobLeasePatch("completed")).toEqual({ worker_lease_id: null, worker_lease_expires_at: null });
  });
});

describe("worker configuration", () => {
  it("runs without DashScope credentials and says what it skips", () => {
    const configured = workerConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" });
    expect(configured).toMatchObject({ alibaba: null });
    expect(skippedWork(configured!)).toEqual([expect.stringContaining("Alibaba jobs and director requests stay queued")]);
    expect(workerConfig({ DASHSCOPE_API_KEY: "k", ALIBABA_WORKSPACE_ID: "w" })).toBeNull();
  });

  it("keeps workflow ticks running and leaves Alibaba jobs queued without credentials", async () => {
    const { client, tables, calls } = world();
    const fetchSpy = dashscope(["RUNNING"]);
    expect(await runWorkerTick({ ...config, alibaba: null }, client)).toBe(false);
    expect(calls.rpc).toEqual(["claim_creative_studio_workflow_run"]);
    expect(job(tables).status).toBe("queued");
    expect(fetchSpy.submit).toBe(0);
  });
});

describe("job lifecycle", () => {
  it("goes submitting → submitted → running → downloading → completed with an event for each step", async () => {
    const { client, tables, fastForward } = world();
    const provider = dashscope(["RUNNING", "SUCCEEDED"]);

    await runWorkerTick(config, client);
    expect(job(tables)).toMatchObject({ status: "submitted", provider_task_id: "task-1", worker_lease_id: null });
    expect(job(tables).submit_attempt_id).toMatch(/^[0-9a-f-]{36}$/);
    fastForward();
    await runWorkerTick(config, client);
    fastForward();
    await runWorkerTick(config, client);

    expect(events(tables)).toEqual(["submitting", "submitted", "running", "downloading", "completed"]);
    expect(provider.submit).toBe(1);
    const asset = tables.creative_studio_assets.find((row) => row.kind === "generated-video");
    expect(asset).toMatchObject({ object_path: generatedVideoPath({ id: jobId, owner_user_id: owner, project_id: project }) });
    expect(job(tables)).toMatchObject({ status: "completed", output_asset_id: asset!.id });
  });

  it("does not submit again after a crash between the provider call and recording its task", async () => {
    const { client, tables } = world(queuedJob({ status: "submitting", submit_attempt_id: "11111111-1111-4111-8111-111111111111" }));
    const provider = dashscope(["RUNNING"]);

    await runWorkerTick(config, client);

    expect(provider.submit).toBe(0);
    expect(job(tables)).toMatchObject({ status: "needs_attention", error_code: "possible_duplicate_submit" });
    expect(tables.creative_studio_job_events).toEqual([
      expect.objectContaining({ event_type: "needs_attention", safe_detail: { errorCode: "possible_duplicate_submit" } }),
    ]);
  });

  it("records the provider task even when the lease moved on during a slow submit", async () => {
    const { client, tables } = world();
    dashscope(["RUNNING"], {
      onSubmit: () => Object.assign(job(tables), { worker_lease_id: "another-worker", status: "needs_attention", error_code: "possible_duplicate_submit" }),
    });

    await runWorkerTick(config, client);

    expect(job(tables)).toMatchObject({ status: "submitted", provider_task_id: "task-1", error_code: null });
  });

  it("stops without writing an event when the lease is lost", async () => {
    const { client, tables } = world(queuedJob({ status: "submitted", provider_task_id: "task-1" }));
    dashscope(["RUNNING"], { onPoll: () => { job(tables).worker_lease_id = "another-worker"; } });

    expect(await runWorkerTick(config, client)).toBe(true);

    expect(job(tables).status).toBe("submitted");
    expect(tables.creative_studio_job_events).toEqual([]);
  });
});

describe("idempotent ingest", () => {
  const downloadingJob = () => queuedJob({ status: "downloading", provider_task_id: "task-1" });
  const path = generatedVideoPath({ id: jobId, owner_user_id: owner, project_id: project });

  it("reuses the asset already recorded for the job instead of creating a second file", async () => {
    const { client, tables, calls } = world(downloadingJob());
    tables.creative_studio_assets.push({ id: "existing", owner_user_id: owner, object_path: path, kind: "generated-video" });
    const provider = dashscope(["SUCCEEDED"]);

    await runWorkerTick(config, client);

    expect(job(tables)).toMatchObject({ status: "completed", output_asset_id: "existing" });
    expect(calls.uploads).toEqual([]);
    expect(provider.download).toBe(0);
    expect(tables.creative_studio_assets.filter((row) => row.object_path === path)).toHaveLength(1);
  });

  it("keeps a complete file from a crashed attempt and only records its asset", async () => {
    const { client, tables, objects, calls } = world(downloadingJob());
    objects.set(path, { bytes: video, contentType: "video/mp4" });
    dashscope(["SUCCEEDED"]);

    await runWorkerTick(config, client);

    expect(calls.uploads).toEqual([]);
    expect(job(tables).status).toBe("completed");
    expect(tables.creative_studio_assets.filter((row) => row.object_path === path)).toHaveLength(1);
  });

  it("replaces a partial file at the same path", async () => {
    const { client, tables, objects, calls } = world(downloadingJob());
    objects.set(path, { bytes: Buffer.from("partial"), contentType: "video/mp4" });
    dashscope(["SUCCEEDED"]);

    await runWorkerTick(config, client);

    expect(calls.uploads).toEqual([path]);
    expect(objects.get(path)!.bytes.equals(video)).toBe(true);
    expect(job(tables).status).toBe("completed");
  });
});
