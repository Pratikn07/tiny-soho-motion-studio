import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getBudget } from "@/app/api/budget/route";
import { POST as startRun } from "@/app/api/creations/[id]/slides/[slideId]/runs/route";
import { POST as retryRun } from "@/app/api/runs/[id]/retry/route";
import { requireOwner } from "@/lib/auth";
import { budgetView, monthlyCapUsd, recordReviewSpend } from "@/lib/budget";
import { budgetResponseSchema, runResponseSchema } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { creationsFakeSupabase } from "./creations-fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./creations-fake-supabase").creationsFakeSupabase> | null }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: () => fake.current!.client }));

const owner = { userId: "00000000-0000-4000-8000-00000000000a", email: "owner@test" };
const creation = contractFixtures.creation;
const potty = creation.document.slides[0];
const now = new Date("2026-09-30T23:00:00.000Z");
const thisMonth = "2026-09-12T10:00:00.000Z";
const lastMonth = "2026-08-30T10:00:00.000Z";
const tables = () => fake.current!.tables;
const request = (method = "GET", body?: unknown) => new Request("https://studio.test", {
  method, headers: { Authorization: "Bearer owner" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(() => {
  fake.current = creationsFakeSupabase();
  vi.mocked(requireOwner).mockResolvedValue(owner);
  vi.useFakeTimers({ now, toFake: ["Date"] });
  tables().creative_studio_spend = [
    { owner_user_id: owner.userId, provider: "modal-ltx", model_id: "ltx-2.5-distilled", job_id: "j1", usd: 0.0301, gpu_seconds: 35.8, occurred_at: thisMonth },
    { owner_user_id: owner.userId, provider: "modal-ltx", model_id: "ltx-2.5-distilled", job_id: "j2", usd: 0.0299, gpu_seconds: 35.5, occurred_at: thisMonth },
    { owner_user_id: owner.userId, provider: "alibaba", model_id: "wan2.7-i2v", job_id: "j3", usd: 0.5, gpu_seconds: null, occurred_at: thisMonth },
    { owner_user_id: owner.userId, provider: "anthropic", model_id: "claude", review_run_id: "r1", job_id: null, usd: 0.02, gpu_seconds: null, occurred_at: thisMonth },
    { owner_user_id: owner.userId, provider: "modal-ltx", model_id: "ltx-2.5-distilled", job_id: "j0", usd: 9, gpu_seconds: 10_000, occurred_at: lastMonth },
    { owner_user_id: "someone-else", provider: "modal-ltx", model_id: "ltx-2.5-distilled", job_id: "jx", usd: 5, gpu_seconds: 1, occurred_at: thisMonth },
  ];
  tables().creative_studio_budget_reservations = [
    { owner_user_id: owner.userId, reservation_key: "run:3", usd: 0.03, status: "open" },
    { owner_user_id: owner.userId, reservation_key: "run:1", usd: 0.0301, status: "converted" },
  ];
  tables().creative_studio_takes = [
    { id: "t1", owner_user_id: owner.userId, verdict: "accepted", created_at: thisMonth },
    { id: "t2", owner_user_id: owner.userId, verdict: "rejected", created_at: thisMonth },
    { id: "t3", owner_user_id: owner.userId, verdict: "accepted", created_at: lastMonth },
  ];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("budget view", () => {
  it("adds this month's ledger by provider, open reservations and cost per accepted clip", async () => {
    const budget = await budgetView(fake.current!.client, owner, 50, now);
    expect(budgetResponseSchema.safeParse(budget).success).toBe(true);
    expect(budget).toMatchObject({
      month: "2026-09", capUsd: 50, spentUsd: 0.58, reservedUsd: 0.03, remainingUsd: 49.39, clipsAccepted: 1,
      costPerAcceptedClipUsd: 0.58,
    });
    expect(budget.byProvider).toEqual([
      { provider: "modal-ltx", usd: 0.06, gpuSeconds: 71.3, clips: 2 },
      { provider: "alibaba", usd: 0.5, gpuSeconds: null, clips: 1 },
      { provider: "anthropic", usd: 0.02, gpuSeconds: null, clips: 0 },
    ]);
    expect(budget.notes[0]).toContain("not guaranteed");
  });

  it("starts each month from zero", async () => {
    const october = await budgetView(fake.current!.client, owner, 50, new Date("2026-10-01T00:00:01.000Z"));
    expect(october).toMatchObject({ month: "2026-10", spentUsd: 0, reservedUsd: 0.03, clipsAccepted: 0, costPerAcceptedClipUsd: null });
  });

  it("reads the cap from TINY_SOHO_MONTHLY_CAP_USD and serves it at GET /api/budget", async () => {
    expect(monthlyCapUsd({})).toBe(50);
    expect(monthlyCapUsd({ TINY_SOHO_MONTHLY_CAP_USD: "nope" })).toBe(0);
    vi.stubEnv("TINY_SOHO_MONTHLY_CAP_USD", "0.10");
    const body = budgetResponseSchema.parse(await (await getBudget(request())).json());
    expect(body).toMatchObject({ capUsd: 0.1, remainingUsd: 0 });
  });
});

describe("budget checks before a take", () => {
  beforeEach(() => {
    const document = structuredClone(creation.document);
    document.slides.forEach((slide) => { delete slide.latestRunId; delete slide.chosenTakeId; });
    tables().creative_studio_projects = [{
      id: creation.id, owner_user_id: owner.userId, name: document.name, carousel_document: document, carousel_revision: 4,
      updated_at: thisMonth,
    }];
    tables().creative_studio_model_acknowledgements = [
      { owner_user_id: owner.userId, model_id: "provider:modal-ltx", contract_version: "modal-billing-v1" },
    ];
  });
  const start = (idempotencyKey = crypto.randomUUID()) => startRun(
    request("POST", { idempotencyKey, motion: contractFixtures.createRunRequest.motion }),
    { params: Promise.resolve({ id: creation.id, slideId: potty.id }) },
  );

  it("refuses a run that wouldn't fit before queuing anything, and still replays an existing one", async () => {
    vi.stubEnv("TINY_SOHO_MONTHLY_CAP_USD", "0.64");
    const key = crypto.randomUUID();
    const first = await start(key);
    expect(first.status).toBe(201);
    vi.stubEnv("TINY_SOHO_MONTHLY_CAP_USD", "0.62");
    const refused = await (await start()).json();
    expect(refused.error).toMatchObject({ code: "budget_exceeded" });
    expect(refused.error.message).toContain("Nothing was charged");
    expect((await start(key)).status).toBe(200);
    expect(tables().creative_studio_pipeline_runs).toHaveLength(1);
  });

  it("checks the budget before another take", async () => {
    const { run } = runResponseSchema.parse(await (await start()).json());
    tables().creative_studio_pipeline_runs[0].status = "needs_attention";
    vi.stubEnv("TINY_SOHO_MONTHLY_CAP_USD", "0.6");
    const refused = await retryRun(request("POST"), { params: Promise.resolve({ id: run.id }) });
    expect((await refused.json()).error.code).toBe("budget_exceeded");
    expect(tables().creative_studio_pipeline_runs[0]).toMatchObject({ status: "needs_attention", max_attempts: 3 });
  });
});

describe("review spend", () => {
  it("records a paid review once and nothing for a free one", async () => {
    tables().creative_studio_spend = [];
    await recordReviewSpend(fake.current!.client, owner, { id: "r9", provider: "nvidia", model: "nemotron", costUsd: 0 });
    await recordReviewSpend(fake.current!.client, owner, { id: "r9", provider: "anthropic", model: "claude", costUsd: 0.027 });
    await recordReviewSpend(fake.current!.client, owner, { id: "r9", provider: "anthropic", model: "claude", costUsd: 0.027 });
    expect(tables().creative_studio_spend).toEqual([expect.objectContaining({ review_run_id: "r9", usd: 0.027, provider: "anthropic" })]);
  });
});
