// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockReelsApi } from "@/components/reels/mock-api";
import { ReelsStudio } from "@/components/reels/ReelsStudio";
import { earlierLooks, jobKey, lookSchema, reelActionSchema, ReelsRepository, safeSketch } from "@/lib/reels";

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

  it("turns readable job keys into stable uuids the database accepts", async () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const key = await jobKey("review-c867b3f1-f8e4-4e38-9b45-61059967ca96-x");
    expect(key).toMatch(uuid);
    expect(await jobKey("review-c867b3f1-f8e4-4e38-9b45-61059967ca96-x")).toBe(key);
    expect(await jobKey("sketches-j1-v1-1")).not.toBe(key);
    expect(await jobKey("C867B3F1-F8E4-4E38-9B45-61059967CA96")).toBe("c867b3f1-f8e4-4e38-9b45-61059967ca96");
    expect(await jobKey()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps looks shown earlier, newest first, without repeats", () => {
    const map = { ...LOOK, name: "Weather map", treatment: "Gouache map paper" };
    const marker = { ...LOOK, name: "Marker Notes", treatment: "Marker on a cream desk" };
    const revised = { ...marker, treatment: "Marker on a cream desk, rose accent" };
    expect(earlierLooks([marker, undefined, map, { ...map, name: "WEATHER MAP" }], [LOOK])).toEqual([marker, map]);
    expect(earlierLooks([marker, revised], [revised])).toEqual([marker]);
    expect(earlierLooks(Array.from({ length: 20 }, (_, n) => ({ ...LOOK, name: `L${n}` })))).toHaveLength(12);
  });

  it("moves the looks on screen to earlier when new ones arrive, and lets an earlier one be chosen", async () => {
    const map = { ...LOOK, name: "Weather map", treatment: "Gouache map paper" };
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }] });
    const base = { id: REEL, title: "T", status: "in_progress", currentStep: "storyboard" as const, updatedAt: "" };
    const view = await new ReelsRepository(client as never, OWNER).absorb({ ...base, document: { look: { options: [map], rejected: ["Weather map"] } },
      jobs: { storyboard: job("j2", "storyboard", { phase: "look", looks: [LOOK] }) } });
    expect(view.document.look).toMatchObject({ options: [LOOK], earlier: [map], rejected: ["Weather map"] });

    const picking = fakeClient({
      creative_studio_reels: [reelRow({ script: { lines, approved: true }, look: { options: [LOOK], rejected: [], earlier: [map] } }, "storyboard"), { data: null, error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(picking as never, OWNER).act(REEL, { action: "choose_look", index: 0, earlier: true });
    const saved = picking.writes.find((write) => write.op === "update")!.value as Record<string, any>;
    expect(saved.document.look).toMatchObject({ chosen: map, options: [LOOK], earlier: [] });
    expect(picking.writes.find((write) => write.op === "insert")!.value).toMatchObject({ input: { phase: "scenes", look: map } });
  });

  it("keeps a chosen look under earlier looks when asking for other ones", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow({ script: { lines, approved: true }, look: { options: [LOOK], chosen: LOOK, rejected: [] } }, "storyboard"), { data: null, error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "more_looks" });
    const saved = client.writes.find((write) => write.op === "update")!.value as Record<string, any>;
    expect(saved.document.look).toMatchObject({ options: [LOOK], earlier: [LOOK] });
    expect(saved.document.look.chosen).toBeUndefined();
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
    // The three looks shown before stay on the page, folded under Earlier looks, so they can still be picked.
    const earlier = screen.getByText("Earlier looks (3)").closest("details")!;
    expect(within(earlier).getAllByRole("button", { name: "Use this look" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Use this look" })).toHaveLength(4);
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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#F4EADC"/></svg>';
const sketchJob = (id: string, result: Record<string, unknown>) => ({ ...job(id, "storyboard", result), kind: "render" });

describe("Storyboard sketches", () => {
  it("accepts plain SVG sketches and refuses anything that could run or load something", () => {
    expect(safeSketch(SVG)).toBe(SVG);
    for (const bad of [
      '<svg><script>alert(1)</script></svg>', '<svg onload="x()"><rect/></svg>', '<svg><image href="https://x.test/a.png"/></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>', '<svg><rect style="fill:url(https://x.test)"/></svg>', "<div>no</div>", `<svg>${"x".repeat(20_000)}</svg>`,
    ]) expect(safeSketch(bad)).toBeNull();
  });

  it("queues one sketch job when new scenes arrive", async () => {
    const client = fakeClient({
      creative_studio_reels: [{ data: null, error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: null, error: null }, { data: [], error: null }],
    });
    const repo = new ReelsRepository(client as never, OWNER);
    const view = { id: REEL, title: "T", status: "in_progress", currentStep: "storyboard" as const, updatedAt: "",
      document: { script: { lines: [{ time: "0:00", voice: "Hook", onScreen: "HOOK" }], approved: true }, look: { options: [LOOK], rejected: [], chosen: LOOK } },
      jobs: { storyboard: job("j1", "storyboard", { phase: "scenes", scenes: [SCENE] }) } };
    await repo.absorb(view);
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "storyboard", kind: "render", input: { phase: "sketches", version: 1, only: [1] } });
    // The database column is a uuid: a readable key like "sketches-j1-v1-1" would be rejected.
    expect(queued.idempotency_key).toBe(await jobKey("sketches-j1-v1-1"));
    expect(queued.input.scenes[0].sketch).toBeUndefined();
    const saved = (client.writes.find((write) => write.op === "update")!.value as Record<string, any>).document;
    expect(saved.storyboard.sketchesQueued).toBe("j1-v1");
    // Read again before the sketches come back: nothing new is queued.
    const writes = client.writes.length;
    await repo.absorb({ ...view, document: saved });
    expect(client.writes.length).toBe(writes);
  });

  it("folds sketches into the version they were drawn for, and ignores an older version", async () => {
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }] });
    const repo = new ReelsRepository(client as never, OWNER);
    const storyboard = { version: 2, scenes: [SCENE, { ...SCENE, n: 2 }], approved: false, fromJob: "j1", sketchesQueued: "j1-v2" };
    const base = { id: REEL, title: "T", status: "in_progress", currentStep: "storyboard" as const, updatedAt: "", document: { look: { options: [LOOK], rejected: [], chosen: LOOK }, storyboard } };
    const old = await repo.absorb({ ...base, jobs: { storyboard: sketchJob("s0", { phase: "sketches", version: 1, sketches: [{ n: 1, svg: SVG }] }) } });
    expect(old.document.storyboard?.scenes[0].sketch).toBeUndefined();
    const drawn = await repo.absorb({ ...base, jobs: { storyboard: sketchJob("s1", { phase: "sketches", version: 2, sketches: [{ n: 1, svg: SVG }, { n: 2, svg: "<svg onload=x()></svg>" }] }) } });
    expect(drawn.document.storyboard?.scenes[0].sketch).toBe(SVG);
    expect(drawn.document.storyboard?.scenes[1].sketch).toBeUndefined();
  });

  it("folds sketches into a storyboard approved before sketches existed", async () => {
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }] });
    const storyboard = { version: 1, scenes: [SCENE], approved: true, fromJob: "j1" };
    const view = { id: REEL, title: "T", status: "in_progress", currentStep: "images" as const, updatedAt: "",
      document: { look: { options: [LOOK], rejected: [], chosen: LOOK }, storyboard },
      jobs: { storyboard: sketchJob("s1", { phase: "sketches", version: 1, sketches: [{ n: 1, svg: SVG }] }) } };
    const drawn = await new ReelsRepository(client as never, OWNER).absorb(view);
    expect(drawn.document.storyboard).toMatchObject({ approved: true, scenes: [{ sketch: SVG }] });
    expect(client.writes.filter((write) => write.op === "insert")).toHaveLength(0);
  });

  it("keeps sketches of scenes a change left alone, and sends the scenes' words without sketches", async () => {
    const client = fakeClient({
      creative_studio_reels: [{ data: null, error: null }, reelRow({}, "storyboard")],
      creative_studio_reel_jobs: [{ data: null, error: null }, { data: [], error: null }],
    });
    const repo = new ReelsRepository(client as never, OWNER);
    const previous = { version: 1, scenes: [{ ...SCENE, sketch: SVG }, { ...SCENE, n: 2, sketch: SVG }], approved: false, fromJob: "j1" };
    const view = { id: REEL, title: "T", status: "in_progress", currentStep: "storyboard" as const, updatedAt: "",
      document: { look: { options: [LOOK], rejected: [], chosen: LOOK }, storyboard: previous },
      jobs: { storyboard: job("j2", "storyboard", { phase: "scenes", scenes: [SCENE, { ...SCENE, n: 2, move: "Stamp" }] }) } };
    await repo.absorb(view);
    const saved = (client.writes.find((write) => write.op === "update")!.value as Record<string, any>).document;
    expect(saved.storyboard.scenes[0].sketch).toBe(SVG);
    expect(saved.storyboard.scenes[1].sketch).toBeUndefined();
    expect(saved.storyboardHistory[0].scenes[0].sketch).toBeUndefined();
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued.input.only).toEqual([2]);
  });
});

describe("Reels screens: sketches", () => {
  it("shows a sketch per scene, a storyboard sheet and a silent preview", { timeout: 20_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: "TITLE: Sketch test\nHOOK: A hook\nSERIES: Myths" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use this look" }))[0]);
    await screen.findByRole("heading", { name: "Approve the storyboard" });

    await waitFor(() => expect(screen.getAllByRole("img", { name: /^Sketch of scene/ })).toHaveLength(7), { timeout: 8000 });
    fireEvent.click(screen.getByRole("radio", { name: "Storyboard sheet" }));
    const sheet = screen.getByRole("list", { name: "Storyboard sheet" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(7);
    expect(within(sheet).getByText("0:00–0:04")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const player = screen.getByRole("dialog", { name: "Storyboard preview" });
    fireEvent.click(within(player).getByRole("button", { name: "Pause" }));
    fireEvent.click(within(player).getByRole("button", { name: "Next" }));
    expect(within(player).getByRole("img", { name: /^Sketch of scene 2/ })).toBeInTheDocument();
    fireEvent.click(within(player).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Reels screens: images", () => {
  it("uploads each image once, shows the checks and the Mac's look, then continues", { timeout: 20_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: "TITLE: Upload test\nHOOK: A hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use this look" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve storyboard" }));

    expect(await screen.findByRole("heading", { name: "Make the images" })).toBeInTheDocument();
    expect(screen.getByText("0 of 1 uploaded · 0 look good")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reused, nothing to make" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Voice" })).toBeDisabled();

    const jpeg = new File(["x"], "anaika.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Upload r02_01_anaika_yawn.png"), { target: { files: [jpeg] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("needs a transparent background");

    const png = new File(["x"], "anaika.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload r02_01_anaika_yawn.png"), { target: { files: [png] } });
    expect(await screen.findByText("Transparent background, as asked.")).toBeInTheDocument();
    expect(await screen.findByText(/Looks good\./)).toBeInTheDocument();
    expect(screen.getByText("1 of 1 uploaded · 1 look good")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue to Voice" }));
    const rail = screen.getByRole("navigation", { name: "Reel steps" });
    await waitFor(() => expect(within(rail).getByRole("button", { name: /Images/ })).toHaveTextContent("Done"));
  });
});

const TAKE = (id: string, gap: number, objectPath = `owners/o/reels/r/voice/${id}.mp3`) => ({
  id, label: id === "a" ? "Natural" : "Tight", gap, stability: 0.45, objectPath, seconds: 5.2,
  lines: [{ n: 1, text: "[curious] Hook", start: 0, end: 2 }, { n: 2, text: "End", start: 2 + gap, end: 5.2 }],
  words: [{ n: 1, word: "Hook", start: 0.1, end: 0.5 }], cueCheck: { ok: true, spokenCues: [], heard: 1, transcript: "Hook End" },
});
const voiceJob = (id: string, result: Record<string, unknown>) => ({ ...job(id, "storyboard", result), step: "voice" as const });

describe("ReelsRepository: voice", () => {
  const imagesDoc = { script: { lines: [{ time: "0:00", voice: "[curious] Hook", onScreen: "H" }, { time: "0:02", voice: "End", onScreen: "E" }], approved: true },
    look: { options: [LOOK], rejected: [], chosen: LOOK }, storyboard: { version: 1, scenes: [{ ...SCENE, images: [] }], approved: true } };

  it("moves to Voice and queues both takes when the images are done", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow(imagesDoc, "images"), { data: null, error: null }, reelRow({}, "voice")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "continue_images" });
    expect((client.writes.find((write) => write.op === "update")!.value as Record<string, unknown>).current_step).toBe("voice");
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "voice", kind: "draft", input: { phase: "takes", lines: ["[curious] Hook", "End"] } });
  });

  it("folds new takes in, then a redone line into its take only", async () => {
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }, { data: null, error: null }] });
    const repo = new ReelsRepository(client as never, OWNER);
    const base = { id: REEL, title: "T", status: "in_progress", currentStep: "voice" as const, updatedAt: "" };
    const first = await repo.absorb({ ...base, document: imagesDoc, jobs: { voice: voiceJob("v1", { phase: "takes", takes: [TAKE("a", 0.3), TAKE("b", 0.2)], credits: { used: 400, remaining: 38000, limit: 40000 } }) } });
    expect(first.document.voice).toMatchObject({ fromJob: "v1", credits: { used: 400 } });
    expect(first.document.voice?.takes.map((take) => take.id)).toEqual(["a", "b"]);
    const chosen = { ...first.document, voice: { ...first.document.voice!, chosen: "b" } };
    const redone = await repo.absorb({ ...base, document: chosen, jobs: { voice: voiceJob("v2", { phase: "line", takes: [TAKE("b", 0.2, "owners/o/reels/r/voice/b2.mp3")] }) } });
    expect(redone.document.voice?.takes.map((take) => take.objectPath)).toEqual(["owners/o/reels/r/voice/a.mp3", "owners/o/reels/r/voice/b2.mp3"]);
    expect(redone.document.voice).toMatchObject({ chosen: "b", approved: false, fromJob: "v2" });
  });

  it("redoes one line with the creator's note, and approves only a chosen take", async () => {
    const doc = { ...imagesDoc, voice: { takes: [TAKE("a", 0.3)], fromJob: "v1" } };
    const client = fakeClient({
      creative_studio_reels: [reelRow(doc, "voice"), { data: null, error: null }, reelRow({}, "voice"), reelRow(doc, "voice")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }, { data: [], error: null }],
    });
    const repo = new ReelsRepository(client as never, OWNER);
    await repo.act(REEL, { action: "redo_line", take: "a", n: 2, note: "softer" });
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "voice", kind: "revise", input: { phase: "line", take: { id: "a", gap: 0.3 }, n: 2, note: "softer" } });
    await expect(repo.act(REEL, { action: "approve_voice" })).rejects.toMatchObject({ code: "no_take" });
  });
});

describe("Reels screens: voice", () => {
  it("records two takes, redoes a line, chooses one and approves", { timeout: 25_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: "TITLE: Voice test\nHOOK: A hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use this look" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve storyboard" }));
    fireEvent.change(await screen.findByLabelText("Upload r02_01_anaika_yawn.png"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await screen.findByText(/Looks good\./);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Voice" }));

    expect(await screen.findByRole("heading", { name: "Choose the voice take" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: "Natural take" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Tight take" })).toBeInTheDocument();
    expect(screen.getByText(/Last recording used 412 ElevenLabs characters · 38,398 of 40,000 left this month/)).toBeInTheDocument();
    expect(screen.getAllByText(/No cues read aloud/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve voice" })).toBeDisabled();

    const tight = screen.getByRole("article", { name: "Tight take" });
    fireEvent.click(within(tight).getAllByRole("button", { name: "Redo this line" })[0]);
    fireEvent.change(within(tight).getByLabelText("Redo this line"), { target: { value: "slower" } });
    fireEvent.click(within(tight).getByRole("button", { name: "Redo line" }));
    expect(await screen.findByText(/Last recording used 48 ElevenLabs characters/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("article", { name: "Tight take" })).getByRole("button", { name: "Use this take" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve voice" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Approve voice" }));
    const rail = screen.getByRole("navigation", { name: "Reel steps" });
    await waitFor(() => expect(within(rail).getByRole("button", { name: /Voice/ })).toHaveTextContent("Done"));
  });
});

describe("ReelsRepository: brief references", () => {
  it("carries links from the brief's REFERENCES line into the reel", async () => {
    const client = fakeClient({ creative_studio_reels: [reelRow({}, "script"), reelRow({}, "script")], creative_studio_reel_jobs: [{ data: null, error: null }, { data: [], error: null }] });
    await new ReelsRepository(client as never, OWNER).create({ topic: "", brief: "HOOK: A hook\nREFERENCES: https://www.are.na/pratik-nandoskar/halloween, https://prompt-motion.com/x4b47x-9cc84f" });
    const reel = client.writes.find((write) => write.table === "creative_studio_reels")!.value as Record<string, any>;
    expect(reel.document.references).toEqual(["https://www.are.na/pratik-nandoskar/halloween", "https://prompt-motion.com/x4b47x-9cc84f"]);
  });
});

const BUILD = (version: number) => ({ phase: "build", reelNo: 3, version, seconds: 21.4, preview: `owners/o/reels/r/build/v${version}.mp4`,
  stills: [{ n: 1, t: 1.5, objectPath: `owners/o/reels/r/build/v${version}-1.jpg` }], commit: "abc1234", notes: "Built." });

describe("ReelsRepository: build", () => {
  const voiced = { script: { lines: [{ time: "0:00", voice: "Hook", onScreen: "H" }], approved: true }, look: { options: [LOOK], rejected: [], chosen: LOOK },
    storyboard: { version: 1, scenes: [{ ...SCENE, sketch: "<svg></svg>" }], approved: true },
    images: { "r01.png": { file: "r01.png", objectPath: "owners/o/reels/r/images/r01.png" } } as never,
    voice: { takes: [TAKE("a", 0.3)], chosen: "a" } };

  it("approving the voice queues the first build as reel 03, with links to the take and images", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow(voiced, "voice"), { data: null, error: null }, { data: [{ id: "x", document: {} }], error: null }, { data: null, error: null }, reelRow({}, "build")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "approve_voice" });
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "build", kind: "draft", input: { reelNo: 3, version: 1, sources: { "voiceover.mp3": "owners/o/reels/r/voice/a.mp3", "r01.png": "owners/o/reels/r/images/r01.png" } } });
    expect(queued.input.scenes[0].sketch).toBeUndefined();
  });

  it("numbers the next reel after the highest taken", async () => {
    const client = fakeClient({
      creative_studio_reels: [reelRow({ ...voiced, voice: { ...voiced.voice, approved: true } }, "build"), { data: [{ id: "x", document: { build: { reelNo: 7 } } }], error: null }, { data: null, error: null }, reelRow({}, "build")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "rebuild" });
    expect((client.writes.find((write) => write.op === "insert")!.value as Record<string, any>).input.reelNo).toBe(8);
  });

  it("folds each finished build in as a new version", async () => {
    const client = fakeClient({ creative_studio_reels: [{ data: null, error: null }, { data: null, error: null }] });
    const repo = new ReelsRepository(client as never, OWNER);
    const base = { id: REEL, title: "T", status: "in_progress", currentStep: "build" as const, updatedAt: "" };
    const doc = { ...voiced, build: { reelNo: 3, versions: [] } };
    const first = await repo.absorb({ ...base, document: doc, jobs: { build: { ...job("b1", "storyboard", BUILD(1)), step: "build" as const } } });
    expect(first.document.build?.versions).toHaveLength(1);
    const again = await repo.absorb({ ...base, document: first.document, jobs: { build: { ...job("b1", "storyboard", BUILD(1)), step: "build" as const } } });
    expect(again.document.build?.versions).toHaveLength(1);
    const second = await repo.absorb({ ...base, document: first.document, jobs: { build: { ...job("b2", "storyboard", BUILD(2)), step: "build" as const } } });
    expect(second.document.build?.versions.map((item) => item.version)).toEqual([1, 2]);
  });
});

describe("Reels screens: build", () => {
  it("builds after the voice is approved, rebuilds one scene and approves", { timeout: 30_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: "TITLE: Build test\nHOOK: A hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use this look" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve storyboard" }));
    fireEvent.change(await screen.findByLabelText("Upload r02_01_anaika_yawn.png"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await screen.findByText(/Looks good\./);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Voice" }));
    fireEvent.click(within(await screen.findByRole("article", { name: "Natural take" })).getByRole("button", { name: "Use this take" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve voice" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Approve voice" }));

    expect(await screen.findByRole("heading", { name: "Approve the build" })).toBeInTheDocument();
    expect(screen.getByText(/Reel 03 · version 1/)).toBeInTheDocument();
    const scenes = screen.getByRole("list", { name: "Scenes in this build" });
    expect(within(scenes).getAllByRole("img")).toHaveLength(7);
    fireEvent.click(within(scenes).getAllByRole("button", { name: "Change this scene" })[0]);
    fireEvent.change(within(scenes).getByLabelText("Change this scene"), { target: { value: "hold longer" } });
    fireEvent.click(within(scenes).getByRole("button", { name: "Rebuild scene" }));
    expect(await screen.findByText(/Reel 03 · version 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve build" }));
    const rail = screen.getByRole("navigation", { name: "Reel steps" });
    await waitFor(() => expect(within(rail).getByRole("button", { name: /Build/ })).toHaveTextContent("Done"));
  });
});

describe("ReelsRepository: sound and export", () => {
  const built = { script: { lines: [{ time: "0:00", voice: "Hook", onScreen: "H" }], approved: true }, look: { options: [LOOK], rejected: [], chosen: LOOK },
    brief: { raw: "x", title: "Four bites", hook: "Hook", series: "Myths" }, storyboard: { version: 1, scenes: [SCENE], approved: true },
    voice: { takes: [TAKE("a", 0.3)], chosen: "a", approved: true }, build: { reelNo: 3, versions: [{ ...BUILD(1), jobId: "b1" }], approved: true } };

  it("approving the build queues the full sound pass for reel 03", async () => {
    const doc = { ...built, build: { ...built.build, approved: false } };
    const client = fakeClient({ creative_studio_reels: [reelRow(doc, "build"), { data: null, error: null }, reelRow({}, "sound")], creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }] });
    await new ReelsRepository(client as never, OWNER).act(REEL, { action: "approve_build" });
    const queued = client.writes.find((write) => write.op === "insert")!.value as Record<string, any>;
    expect(queued).toMatchObject({ step: "sound", kind: "draft", input: { phase: "full", reelNo: 3, version: 1, seconds: 21.4, series: "Myths" } });
  });

  it("changing the music level remixes only, and approving the sound queues the export", async () => {
    const doc = { ...built, sound: { versions: [{ version: 1, preview: "p", musicPrompt: "m", musicDb: -9, cues: [], commit: null, seconds: 21, characters: 0 }] } };
    const client = fakeClient({
      creative_studio_reels: [reelRow(doc, "sound"), reelRow({}, "sound"), reelRow(doc, "sound"), { data: null, error: null }, reelRow({}, "export")],
      creative_studio_reel_jobs: [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }, { data: [], error: null }, { data: null, error: null }, { data: [], error: null }],
    });
    const repo = new ReelsRepository(client as never, OWNER);
    await repo.act(REEL, { action: "music_level", db: -12 });
    const level = client.writes.filter((write) => write.op === "insert")[0].value as Record<string, any>;
    expect(level).toMatchObject({ step: "sound", kind: "revise", input: { phase: "level", musicDb: -12 } });
    await repo.act(REEL, { action: "approve_sound" });
    const exportJob = client.writes.filter((write) => write.op === "insert")[1].value as Record<string, any>;
    expect(exportJob).toMatchObject({ step: "export", kind: "render", input: { reelNo: 3, version: 1, title: "Four bites", lines: ["Hook"] } });
  });
});

describe("Reels screens: brief to download", () => {
  it("goes all the way from a pasted brief to a downloadable video", { timeout: 45_000 }, async () => {
    render(<ReelsStudio api={createMockReelsApi(-10)} macState="online" />);
    fireEvent.change(await screen.findByLabelText("Paste your brief"), { target: { value: "TITLE: End to end\nHOOK: A hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a reel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve script" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use this look" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve storyboard" }));
    fireEvent.change(await screen.findByLabelText("Upload r02_01_anaika_yawn.png"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await screen.findByText(/Looks good\./);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Voice" }));
    fireEvent.click(within(await screen.findByRole("article", { name: "Natural take" })).getByRole("button", { name: "Use this take" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve voice" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Approve voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve build" }));

    expect(await screen.findByRole("heading", { name: "Approve the sound" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Music level under the voice/), { target: { value: "-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply level" }));
    expect(await screen.findByText(/music -12 dB under the voice/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve sound" }));

    expect(await screen.findByRole("heading", { name: "Your reel is ready" })).toBeInTheDocument();
    expect(screen.getByText(/52.4 MB · 1080×1920 · 30 fps/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy caption" })).toBeInTheDocument();
    expect(screen.getByText("#toddlermom #halloweenwithkids #gentleparenting")).toBeInTheDocument();
  });
});
