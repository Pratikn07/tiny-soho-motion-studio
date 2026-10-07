// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockReelsApi } from "@/components/reels/mock-api";
import { ReelsStudio } from "@/components/reels/ReelsStudio";
import { reelActionSchema, ReelsRepository } from "@/lib/reels";

afterEach(() => cleanup());

const OWNER = "33333333-3333-4333-8333-333333333333";
const REEL = "55555555-5555-4555-8555-555555555555";

/** Chainable stand-in for the Supabase client. `answers[table]` is a list of results returned in order. */
function fakeClient(answers: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const next = (table: string) => (answers[table]?.shift() ?? { data: null, error: null });
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "neq", "order", "limit"]) b[op] = () => b;
    for (const op of ["insert", "update"]) b[op] = (value: unknown) => { writes.push({ table, op, value }); return b; };
    b.single = async () => next(table);
    b.maybeSingle = async () => next(table);
    b.then = (resolve: (value: unknown) => void) => resolve(next(table));
    return b;
  };
  return { writes, from: vi.fn(from) };
}
const reelRow = (document: Record<string, unknown> = {}, step = "idea") =>
  ({ data: { id: REEL, title: "Halloween", status: "in_progress", current_step: step, document, revision: 1, updated_at: "2026-10-07T00:00:00Z" }, error: null });

describe("ReelsRepository", () => {
  it("creates a reel and queues three ideas for the Studio Mac", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow({ topic: "Halloween" }), reelRow({ topic: "Halloween" })],
      creative_studio_reel_jobs: [{ data: null, error: null }, { data: [], error: null }],
    });
    const view = await new ReelsRepository(client as never, OWNER).create({ topic: "Halloween" });
    expect(view.currentStep).toBe("idea");
    const job = client.writes.find((write) => write.table === "creative_studio_reel_jobs")!.value as Record<string, unknown>;
    expect(job).toMatchObject({ owner_user_id: OWNER, reel_id: REEL, step: "idea", kind: "draft", input: { topic: "Halloween" } });
  });

  it("moves to the script and queues a draft when an idea is chosen", async () => {
    const idea = { title: "It's not the sugar", hook: "It's probably NOT the sugar.", why: "Myth-buster" };
    const client = fakeClient({
      creative_studio_reels: [reelRow({ topic: "Halloween" }), { data: null, error: null }, reelRow({ topic: "Halloween", idea }, "script")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "choose_idea", idea });
    const update = client.writes.find((write) => write.op === "update")!.value as Record<string, unknown>;
    expect(update).toMatchObject({ current_step: "script", title: idea.title });
    const job = client.writes.find((write) => write.op === "insert")!.value as Record<string, unknown>;
    expect(job).toMatchObject({ step: "script", kind: "draft", input: { idea } });
  });

  it("folds a script the runner finished into the reel, once", async () => {
    const lines = [{ time: "0:00", voice: "Hook", onScreen: "HOOK" }];
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }] });
    const repo = new ReelsRepository(client as never, OWNER);
    const view = { id: REEL, title: "T", status: "in_progress", currentStep: "script" as const, document: {}, updatedAt: "", jobs: {
      script: { id: "j", step: "script" as const, kind: "draft", status: "needs_review" as const, progress: null, errorCode: null, result: { lines, notes: "Check it" }, createdAt: "", updatedAt: "" },
    } };
    const absorbed = await repo.absorb(view);
    expect(absorbed.document.script).toEqual({ lines, notes: "Check it", approved: false });
    expect(client.writes).toHaveLength(1);
    await repo.absorb({ ...view, document: absorbed.document });
    expect(client.writes).toHaveLength(1);
  });

  it("only accepts the creator's known actions", () => {
    expect(reelActionSchema.safeParse({ action: "revise_script", comments: "" }).success).toBe(false);
    expect(reelActionSchema.safeParse({ action: "delete_everything" }).success).toBe(false);
  });
});

describe("Reels screens", () => {
  it("starts a reel, picks an idea, and approves the script", async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    await waitFor(() => expect(screen.getByText("No reels yet. Your first one starts above.")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("What should this reel be about?"), { target: { value: "Halloween meltdowns" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));

    const ideas = await screen.findAllByRole("button", { name: "Use this idea" });
    expect(ideas).toHaveLength(3);
    fireEvent.click(ideas[0]);

    expect(await screen.findByRole("heading", { name: "Approve the script" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    fireEvent.change(screen.getByLabelText("Ask for changes"), { target: { value: "Shorter hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Send changes" }));
    expect(await screen.findByText("Changed: Shorter hook")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve script" }));
    expect(await screen.findByRole("heading", { name: "Storyboard" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Reel steps" });
    expect(within(rail).getByRole("button", { name: /Script/ })).toHaveTextContent("Done");
  });

  it("says the job waits for the Studio Mac while it is asleep", async () => {
    const api = createMockReelsApi(60_000);
    render(<ReelsStudio api={api} macState="asleep" />);
    fireEvent.click(await screen.findByRole("button", { name: "Start a reel" }));
    expect(await screen.findByText(/Waiting for the Studio Mac/)).toBeInTheDocument();
  });
});
