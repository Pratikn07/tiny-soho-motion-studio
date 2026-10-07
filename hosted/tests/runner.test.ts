import { describe, expect, it, vi } from "vitest";

import { StudioError } from "@/lib/errors";
import { readRunnerConfig, requireRunner, RunnerRepository, runnerState, jobUpdateSchema } from "@/lib/runner";

const TOKEN = "t".repeat(48);
const OWNER = "33333333-3333-4333-8333-333333333333";
const config = { token: TOKEN, ownerId: OWNER };
const request = (header?: string) => new Request("https://studio.test/api/runner/claim", { headers: header ? { authorization: header } : {} });

/** A chainable stand-in for the Supabase client: records calls and returns the queued result. */
function fakeClient(results: Record<string, unknown>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const chain = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const op of ["select", "update", "upsert", "eq", "in", "order", "limit"]) {
      builder[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return builder; };
    }
    builder.maybeSingle = async () => results[`${table}.single`] ?? { data: null, error: null };
    builder.then = (resolve: (value: unknown) => void) => resolve(results[table] ?? { data: [], error: null });
    return builder;
  };
  return {
    calls,
    from: vi.fn(chain),
    rpc: vi.fn(async () => results.rpc ?? { data: null, error: null }),
  };
}

describe("runner config and auth", () => {
  it("needs a long token and the owner's user id", () => {
    expect(readRunnerConfig({})).toBeNull();
    expect(readRunnerConfig({ TINY_SOHO_RUNNER_TOKEN: "short", TINY_SOHO_RUNNER_OWNER_ID: OWNER })).toBeNull();
    expect(readRunnerConfig({ TINY_SOHO_RUNNER_TOKEN: TOKEN, TINY_SOHO_RUNNER_OWNER_ID: "nope" })).toBeNull();
    expect(readRunnerConfig({ TINY_SOHO_RUNNER_TOKEN: TOKEN, TINY_SOHO_RUNNER_OWNER_ID: OWNER })).toEqual(config);
  });

  it("accepts only the runner's token", () => {
    expect(requireRunner(request(`Bearer ${TOKEN}`), config)).toEqual({ ownerId: OWNER });
    for (const header of [undefined, "Bearer wrong", `Basic ${TOKEN}`]) {
      expect(() => requireRunner(request(header), config)).toThrowError(StudioError);
    }
    expect(() => requireRunner(request(`Bearer ${TOKEN}`), null)).toThrowError(/not set up/);
  });
});

describe("runner state", () => {
  it("is online within 90 seconds of its last check-in, then asleep", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(runnerState(null, now)).toBe("not-set-up");
    expect(runnerState("2026-10-06T11:59:00Z", now)).toBe("online");
    expect(runnerState("2026-10-06T11:58:00Z", now)).toBe("asleep");
  });
});

describe("RunnerRepository", () => {
  it("returns nothing when the queue is empty", async () => {
    const client = fakeClient({ rpc: { data: { id: null }, error: null } });
    expect(await new RunnerRepository(client as never, OWNER).claim("studio-mac")).toBeNull();
    expect(client.rpc).toHaveBeenCalledWith("claim_creative_studio_reel_job", { runner: "studio-mac" });
  });

  it("returns a claimed job with its reel and lease", async () => {
    const job = { id: "j1", reel_id: "r1", step: "idea", kind: "draft", input: { topic: "Halloween" }, worker_lease_id: "l1", attempt_count: 1 };
    const client = fakeClient({ rpc: { data: job, error: null }, "creative_studio_reels.single": { data: { id: "r1", title: "Sugar" }, error: null } });
    const claimed = await new RunnerRepository(client as never, OWNER).claim("studio-mac");
    expect(claimed).toEqual({ job: { id: "j1", reelId: "r1", step: "idea", kind: "draft", input: { topic: "Halloween" }, leaseId: "l1", attempt: 1 }, reel: { id: "r1", title: "Sugar" } });
  });

  it("only updates a job the runner still holds, and clears the lease when it finishes", async () => {
    const lease = "44444444-4444-4444-8444-444444444444";
    const lost = fakeClient({});
    await expect(new RunnerRepository(lost as never, OWNER).updateJob("j1", { leaseId: lease, status: "running" })).rejects.toThrow(/no longer held/);

    const held = fakeClient({ "creative_studio_reel_jobs.single": { data: { id: "j1", status: "needs_review" }, error: null } });
    await new RunnerRepository(held as never, OWNER).updateJob("j1", { leaseId: lease, status: "needs_review", result: { ideas: [] } });
    const patch = held.calls.find((call) => call.op === "update")!.args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "needs_review", worker_lease_id: null, worker_lease_expires_at: null, result: { ideas: [] } });
    expect(held.calls.filter((call) => call.op === "eq").map((call) => call.args)).toEqual([["id", "j1"], ["worker_lease_id", lease], ["status", "running"]]);
  });

  it("rejects statuses the runner may not set", () => {
    expect(jobUpdateSchema.safeParse({ leaseId: "44444444-4444-4444-8444-444444444444", status: "canceled" }).success).toBe(false);
  });

  it("reports the latest runner and the queue for the Studio Mac chip", async () => {
    const recent = new Date().toISOString();
    const client = fakeClient({
      creative_studio_runners: { data: [{ id: "studio-mac", label: "Studio Mac", claude_auth: "subscription", last_seen_at: recent }], error: null },
      creative_studio_reel_jobs: { data: [{ status: "queued" }, { status: "running" }, { status: "queued" }], error: null },
    });
    const status = await new RunnerRepository(client as never, OWNER).status();
    expect(status).toMatchObject({ state: "online", label: "Studio Mac", claudeAuth: "subscription", queue: { queued: 2, running: 1 } });
  });
});
