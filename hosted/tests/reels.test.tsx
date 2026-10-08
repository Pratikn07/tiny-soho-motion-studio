// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockReelsApi } from "@/components/reels/mock-api";
import { ReelsStudio } from "@/components/reels/ReelsStudio";
import { lookSchema, reelActionSchema, ReelsRepository } from "@/lib/reels";

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
    fireEvent.click(screen.getByRole("radio", { name: "Just a topic" }));
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
    expect(await screen.findByRole("heading", { name: "Choose the look" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Reel steps" });
    expect(within(rail).getByRole("button", { name: /Script/ })).toHaveTextContent("Done");
  });

  it("says the job waits for the Studio Mac while it is asleep", async () => {
    const api = createMockReelsApi(60_000);
    render(<ReelsStudio api={api} macState="asleep" />);
    fireEvent.click(await screen.findByRole("radio", { name: "Just a topic" }));
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    expect(await screen.findByText(/Waiting for the Studio Mac/)).toBeInTheDocument();
  });
});

const LOOK = { name: "Tired mum's diary", treatment: "Lined paper, riso print", emotion: "Wry", accent: "Pumpkin #E8833A",
  signatureMoment: "The calendar circles 31 Oct", music: "Celesta", why: "Feels like her notes" };
const SCENE = { n: 1, line: "Hook", paper: "Cream", codeDraws: "Headline", move: "Rise", transition: "Through the clock",
  images: [{ file: "r02_01_anaika.png", purpose: "Anaika", prompt: "Anaika yawning", aspect: "9:16", background: "transparent" as const, reference: "anaika" as const, reuse: "" }] };
const job = (id: string, step: "script" | "storyboard", result: Record<string, unknown>) =>
  ({ id, step, kind: "draft", status: "needs_review" as const, progress: null, errorCode: null, result, createdAt: "", updatedAt: "" });
const lines = [{ time: "0:00", voice: "Hook", onScreen: "HOOK" }];

describe("ReelsRepository: briefs, references, looks and storyboards", () => {
  it("starts a reel from a brief at the script step and keeps its script draft", async () => {
    const client = fakeClient({ creative_studio_reels: [reelRow({}, "script"), reelRow({}, "script")], creative_studio_reel_jobs: [{ data: null, error: null }, { data: [], error: null }] });
    await new ReelsRepository(client as never, OWNER).create({ topic: "", brief: "TITLE: Worst week\nHOOK: The worst week of the year\nSCRIPT DRAFT:\n1. Line one | Calendar" });
    const reel = client.writes.find((write) => write.table === "creative_studio_reels")!.value as Record<string, any>;
    expect(reel).toMatchObject({ title: "Worst week", current_step: "script", document: { idea: { title: "Worst week", hook: "The worst week of the year" } } });
    expect(reel.document.brief.scriptDraft).toEqual([{ voice: "Line one", onScreen: "Calendar" }]);
    const queued = client.writes.find((write) => write.table === "creative_studio_reel_jobs")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "script", kind: "draft", input: { keepScript: true } });
  });

  it("refuses a brief with nothing to write from", async () => {
    const client = fakeClient({});
    await expect(new ReelsRepository(client as never, OWNER).create({ topic: "", brief: "Some notes" })).rejects.toMatchObject({ code: "brief_unreadable" });
    expect(client.writes).toHaveLength(0);
  });

  it("starts a reel from a reference link and asks the Studio Mac for a breakdown", async () => {
    const client = fakeClient({ creative_studio_reels: [reelRow(), reelRow()], creative_studio_reel_jobs: [{ data: null, error: null }, { data: [], error: null }] });
    await new ReelsRepository(client as never, OWNER).create({ topic: "", reference: "https://www.instagram.com/reel/abc" });
    const queued = client.writes.find((write) => write.table === "creative_studio_reel_jobs")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "idea", kind: "draft", input: { reference: "https://www.instagram.com/reel/abc" } });
  });

  it("asks for looks when the script is approved, avoiding treatments used in the same series", async () => {
    const brief = { raw: "x", hook: "Hook", series: "Halloween" };
    const other = { id: "other", document: { brief: { raw: "y", series: "halloween" }, look: { options: [], rejected: [], chosen: { ...LOOK, name: "Collage", treatment: "Cut paper" } } } };
    const client = fakeClient({
      creative_studio_reels: [reelRow({ brief, script: { lines } }, "script"), { data: null, error: null }, { data: [other], error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "approve_script" });
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "storyboard", kind: "draft", input: { phase: "look", series: "Halloween", count: 3, seriesUsed: ["Collage: Cut paper"] } });
  });

  it("writes the scenes only after a look is chosen", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow({ script: { lines, approved: true }, look: { options: [LOOK], rejected: [] } }, "storyboard"), { data: null, error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "choose_look", index: 0 });
    const saved = client.writes.find((write) => write.op === "update")!.value as Record<string, any>;
    expect(saved.document.look.chosen).toEqual(LOOK);
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "storyboard", input: { phase: "scenes", look: LOOK } });
  });

  it("remembers rejected looks when asked for other ones", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow({ script: { lines, approved: true }, look: { options: [LOOK], rejected: ["Old"] } }, "storyboard"), { data: null, error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "more_looks" });
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued.input).toMatchObject({ phase: "look", count: 3, avoid: ["Old", "Tired mum's diary"] });
  });

  it("folds looks in once, then keeps earlier storyboards as versions", async () => {
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }, { data: null, error: null }] });
    const repo = new ReelsRepository(client as never, OWNER);
    const base = { id: REEL, title: "T", status: "in_progress", currentStep: "storyboard" as const, updatedAt: "" };
    const withLooks = await repo.absorb({ ...base, document: {}, jobs: { storyboard: job("j1", "storyboard", { phase: "look", looks: [LOOK] }) } });
    expect(withLooks.document.look).toEqual({ options: [LOOK], rejected: [], fromJob: "j1" });
    await repo.absorb(withLooks);
    expect(client.writes).toHaveLength(1);

    const first = { version: 1, scenes: [SCENE], approved: false, fromJob: "j2" };
    const second = await repo.absorb({ ...base, document: { storyboard: first }, jobs: { storyboard: job("j3", "storyboard", { phase: "scenes", scenes: [{ ...SCENE, move: "Stamp" }] }) } });
    expect(second.document.storyboard).toMatchObject({ version: 2, fromJob: "j3", scenes: [{ move: "Stamp" }] });
    expect(second.document.storyboardHistory).toEqual([first]);
  });

  it("ignores storyboard results once the reel went back to the script", async () => {
    const client = fakeClient({});
    const view = { id: REEL, title: "T", status: "in_progress", currentStep: "script" as const, updatedAt: "", document: {},
      jobs: { storyboard: job("j1", "storyboard", { phase: "look", looks: [LOOK] }) } };
    expect(await new ReelsRepository(client as never, OWNER).absorb(view)).toBe(view);
    expect(client.writes).toHaveLength(0);
  });

  it("removes a reference link and keeps long look descriptions", async () => {
    const client = fakeClient({ creative_studio_reels: [reelRow({ references: ["https://a.test/1", "https://a.test/2"] }, "storyboard"), { data: null, error: null }, reelRow({}, "storyboard")], creative_studio_reel_jobs: [{ data: [], error: null }, { data: [], error: null }] });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "remove_reference", url: "https://a.test/1" });
    const saved = client.writes.find((write) => write.op === "update")!.value as Record<string, any>;
    expect(saved.document.references).toEqual(["https://a.test/2"]);
    expect(lookSchema.safeParse({ ...LOOK, treatment: "x".repeat(800) }).success).toBe(true);
  });

  it("lets the creator edit one image prompt and asks for approval again", async () => {
    const storyboard = { version: 1, scenes: [SCENE], approved: true };
    const client = fakeClient({ creative_studio_reels: [reelRow({ storyboard }, "storyboard"), { data: null, error: null }, reelRow({}, "storyboard")], creative_studio_reel_jobs: [{ data: [], error: null }, { data: [], error: null }] });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "edit_image_prompt", scene: 1, file: "r02_01_anaika.png", prompt: "Anaika asleep" });
    const saved = client.writes.find((write) => write.op === "update")!.value as Record<string, any>;
    expect(saved.document.storyboard).toMatchObject({ approved: false, scenes: [{ images: [{ prompt: "Anaika asleep" }] }] });
  });
});

describe("Reels screens: brief, looks and storyboard", () => {
  const BRIEF = "TITLE: The Worst Week\nHOOK: Halloween and the clock change, same weekend.\nSERIES: Halloween\nSCRIPT DRAFT:\n1. [curious] The worst week? | Calendar\n2. Save this for 31 Oct. | Heart";

  // Walks a whole reel through the sample runner, so it gets more time than the default on a busy machine.
  it("goes from a pasted brief to an approved storyboard", { timeout: 20_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: BRIEF } });
    expect(screen.getByRole("status")).toHaveTextContent("“The Worst Week” · series Halloween · 2 script lines");
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));

    expect(await screen.findByRole("heading", { name: "Approve the script" })).toBeInTheDocument();
    expect(screen.getByText("Your script from the brief, timed and checked.")).toBeInTheDocument();
    expect(within(await screen.findByRole("table")).getAllByRole("row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Approve script" }));

    expect(await screen.findAllByRole("button", { name: "Use this look" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Show other looks" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Use this look" })).toHaveLength(3));
    fireEvent.click(screen.getAllByRole("button", { name: "Use this look" })[0]);

    expect(await screen.findByRole("heading", { name: "Approve the storyboard" })).toBeInTheDocument();
    expect(await screen.findByText(/1 image to make · 1 reused/)).toBeInTheDocument();
    expect(screen.getByText("Reuse: reel01 clock face with no hands")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Change this scene" })[1]);
    fireEvent.change(screen.getByLabelText("Change this scene"), { target: { value: "Spin it backwards" } });
    fireEvent.click(screen.getByRole("button", { name: "Send changes" }));
    expect(await screen.findByText("Changed: Spin it backwards")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore v1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve storyboard" }));
    expect(await screen.findByRole("heading", { name: "Make the images" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Reel steps" });
    expect(within(rail).getAllByRole("button").map((button) => button.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/04Images/), expect.stringMatching(/05Voice/)]));
  });

  // Walks a whole reel through the sample runner, so it gets more time than the default on a busy machine.
  it("saves reference links, says when they're used, and redoes the scenes with them", { timeout: 20_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: BRIEF } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    await screen.findAllByRole("button", { name: "Use this look" });

    fireEvent.change(screen.getByLabelText("Reference link"), { target: { value: "https://prompt-motion.com/gdgtify-287ddf" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByText(/Saved. The Studio Mac opens these links when you pick a look/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://prompt-motion.com/gdgtify-287ddf" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Use this look" })[0]);
    expect(await screen.findByText(/written before any links you add now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Redo scenes with these links" }));
    expect(await screen.findByText(/Changed: Use the reference links I added/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove https://prompt-motion.com/gdgtify-287ddf" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "https://prompt-motion.com/gdgtify-287ddf" })).not.toBeInTheDocument());
  });

  // Walks a whole reel through the sample runner, so it gets more time than the default on a busy machine.
  it("describes your own look when none of the options fit", { timeout: 20_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: BRIEF } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    fireEvent.change(await screen.findByLabelText("Or describe your own"), { target: { value: "A phone notes app at 2 am" } });
    fireEvent.click(screen.getByRole("button", { name: "Use my description" }));
    expect(await screen.findByText("A phone notes app at 2 am")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use this look" })).toHaveLength(1);
  });

  it("breaks down a reference reel and offers three angles", async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.click(await screen.findByRole("radio", { name: "Reference reel" }));
    fireEvent.change(screen.getByLabelText("Link to the reel"), { target: { value: "https://www.instagram.com/reel/xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    expect(await screen.findByRole("heading", { name: "What makes it work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy for Claude" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use this angle" })).toHaveLength(3);
  });
});
