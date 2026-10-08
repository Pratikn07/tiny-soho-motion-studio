import { parseBrief } from "@/lib/reel-brief";
import type { ReelAction, ReelDocument, ReelJobView, ReelLook, ReelScene, ReelStep, ReelView, ScriptLine } from "@/lib/reels";
import type { ReelsApi } from "./api";

/** Sample data for the development preview: a stand-in runner answers each job a few seconds after it is queued. */
const SAMPLE_IDEAS = [
  { title: "It's not the sugar", hook: "That Halloween meltdown? It's probably NOT the sugar.", why: "Busts a myth every parent believes, with a study they can share." },
  { title: "Halloween + clocks go back", hook: "This year Halloween and the time change land on the SAME weekend.", why: "Timely and useful, and nobody else will make it." },
  { title: "Why the inflatable is terrifying", hook: "Your toddler isn't being dramatic about the giant dinosaur.", why: "Explains a moment every parent has filmed." },
];
const SAMPLE_SCRIPT: ScriptLine[] = [
  { time: "0:00", voice: "[curious] That Halloween meltdown? It's probably NOT the sugar.", onScreen: "IT'S NOT THE SUGAR." },
  { time: "0:04", voice: "Careful studies haven't found that sugar changes kids' behavior.", onScreen: "MYTH stamp" },
  { time: "0:08", voice: "In one study, moms were told their kid had sugar. They rated them more hyper. [pause] The drink? Sugar-free.", onScreen: "Clipboard, label peel" },
  { time: "0:16", voice: "[curious] So what IS it?", onScreen: "Anaika looks up" },
  { time: "0:18", voice: "The night itself. Masks. Doorbells. A bedtime two hours late.", onScreen: "Three stickers" },
  { time: "0:23", voice: "[warmly] So skip the candy guilt. Protect the bedtime.", onScreen: "Anaika asleep" },
  { time: "0:27", voice: "Save this for Halloween night.", onScreen: "Tiny Soho heart" },
];
const SAMPLE_BREAKDOWN = {
  url: "https://www.instagram.com/reel/sample", seconds: 41.2, cuts: 17,
  summary: "A mom lists the toddler bedtime excuses she hears every night, each one a quick cut with a big caption.",
  hook: "“My toddler has 14 ways to avoid bed. Number 6 is genius.”", hookSeconds: 1.4,
  pacing: "A cut every 2.4 s, faster in the list, a held beat before the payoff.", structure: "Hook, list of 7, twist (the mom stalls too), save prompt.",
  textStyle: "Big white sans captions, one word highlighted in yellow.", emotion: "Wry, tired, affectionate.",
  works: ["The numbered list keeps people waiting for 'number 6'.", "Every excuse is a real one parents recognise."],
  borrow: ["A numbered countdown as the spine.", "A held beat before the twist."],
  avoid: ["Their exact excuses and wording.", "The talking-head format."],
  transcript: "My toddler has fourteen ways to avoid bed...",
};
const SAMPLE_LOOKS: ReelLook[] = [
  { name: "Tired mum's diary", treatment: "Lined notebook pages, two-colour riso print, handwritten crossings-out.", emotion: "Wry, honest",
    accent: "Pumpkin #E8833A", signatureMoment: "The calendar circles 31 Oct harder each time.", music: "Celesta and a ticking clock", why: "It feels like a mom's own notes." },
  { name: "Paper theatre", treatment: "Cut-out characters on sticks in front of a lit paper stage.", emotion: "Storybook, warm",
    accent: "Candle gold #F3C46B", signatureMoment: "The curtain drops on bedtime.", music: "Music box", why: "Turns the night into a little play." },
  { name: "Porch camera", treatment: "One fixed frame of the porch as the night passes.", emotion: "Observational",
    accent: "Porch-light amber", signatureMoment: "The clock on the wall jumps an hour back.", music: "Soft plucked strings", why: "Time passing is the story." },
];
const sampleScenes = (look: ReelLook): ReelScene[] => SAMPLE_SCRIPT.map((line, index) => ({
  n: index + 1, line: line.voice, paper: index % 2 ? "Night #1F2340" : "Cream #F4EADC", codeDraws: line.onScreen,
  move: "Rises in on the stressed word", transition: "The hero object carries into the next scene",
  images: index === 0 ? [{ file: "r02_01_anaika_yawn.png", purpose: "Anaika yawning in her pumpkin costume", aspect: "9:16", background: "transparent" as const,
    reference: "anaika" as const, reuse: "", prompt: `Anaika, a toddler in a pumpkin costume, mid-yawn, in the style of ${look.name.toLowerCase()}.` }]
    : index === 4 ? [{ file: "r02_05_clock.png", purpose: "The clock", aspect: "1:1", background: "transparent" as const, reference: "none" as const,
      reuse: "reel01 clock face with no hands", prompt: "" }] : [],
}));

type MockJob = ReelJobView & { readyAt: number; output: Record<string, unknown> };
type MockReel = Omit<ReelView, "jobs"> & { jobs: MockJob[] };

export function createMockReelsApi(delayMs = 2500): ReelsApi {
  const reels = new Map<string, MockReel>();
  const now = () => new Date().toISOString();
  const queue = (reel: MockReel, step: ReelStep, kind: string, output: Record<string, unknown>) => {
    reel.jobs.unshift({ id: crypto.randomUUID(), step, kind, status: "queued", progress: null, errorCode: null, result: null,
      createdAt: now(), updatedAt: now(), readyAt: Date.now() + delayMs, output });
  };
  const absorb = (reel: MockReel, latest: ReelView["jobs"]) => {
    const doc = reel.document;
    const script = latest.script;
    const lines = script?.result?.lines as ScriptLine[] | undefined;
    if (script?.status === "needs_review" && lines && !doc.script?.approved && doc.script?.lines !== lines) {
      reel.document = { ...doc, script: { lines, notes: String(script.result?.notes ?? ""), approved: false } };
    }
    const board = latest.storyboard;
    if (reel.currentStep !== "storyboard" || board?.status !== "needs_review" || !board.result) return;
    if (board.result.phase === "look" && reel.document.look?.fromJob !== board.id) {
      reel.document = { ...reel.document, look: { options: board.result.looks as ReelLook[], rejected: reel.document.look?.rejected ?? [], fromJob: board.id } };
    }
    if (board.result.phase === "scenes" && reel.document.storyboard?.fromJob !== board.id) {
      const previous = reel.document.storyboard;
      reel.document = { ...reel.document, storyboard: { version: (previous?.version ?? 0) + 1, scenes: board.result.scenes as ReelScene[],
        notes: String(board.result.notes ?? ""), approved: false, fromJob: board.id },
      storyboardHistory: previous ? [previous, ...(reel.document.storyboardHistory ?? [])].slice(0, 5) : reel.document.storyboardHistory };
    }
  };
  const view = (id: string): ReelView => {
    const reel = reels.get(id);
    if (!reel) throw new Error("That reel was not found.");
    for (const job of reel.jobs) {
      if (job.status === "queued" && Date.now() > job.readyAt - delayMs / 2) { job.status = "running"; job.progress = "Sample runner is working"; }
      if (job.status === "running" && Date.now() > job.readyAt) { job.status = "needs_review"; job.result = job.output; job.progress = "Ready for review"; }
    }
    const latest: ReelView["jobs"] = {};
    for (const job of reel.jobs) if (!latest[job.step]) latest[job.step] = job;
    absorb(reel, latest);
    return structuredClone({ ...reel, jobs: latest });
  };
  const looks = (doc: ReelDocument, count: number, note?: string) => ({ phase: "look", looks: (doc.brief?.treatment && count === 1
    ? [{ ...SAMPLE_LOOKS[0], name: "Your treatment", treatment: doc.brief.treatment }]
    : SAMPLE_LOOKS.filter((look) => !doc.look?.rejected.includes(look.name)).concat(SAMPLE_LOOKS).slice(0, count))
    .map((look) => (note ? { ...look, why: note } : look)) });
  return {
    list: async () => [...reels.values()].map((reel) => ({ id: reel.id, title: reel.title, status: reel.status, currentStep: reel.currentStep, updatedAt: reel.updatedAt })),
    create: async (input) => {
      const id = crypto.randomUUID();
      const reel: MockReel = { id, title: "New reel", status: "in_progress", currentStep: "idea", document: {}, updatedAt: now(), jobs: [] };
      if ("brief" in input) {
        const brief = parseBrief(input.brief)!;
        reel.title = brief.title ?? "New reel";
        reel.document = { brief, idea: { title: reel.title, hook: brief.hook ?? "", why: brief.angle ?? "" } };
        reel.currentStep = "script";
        const lines = brief.scriptDraft?.map((line, i) => ({ time: `0:${String(i * 4).padStart(2, "0")}`, ...line }));
        queue(reel, "script", "draft", { lines: lines ?? SAMPLE_SCRIPT, notes: lines ? "Kept your wording. 62 words, within the rules." : "Sample script. On the Studio Mac, Claude writes it from your brief." });
      } else if ("reference" in input) {
        reel.title = "Reel from a reference";
        reel.document = { reference: { url: input.reference } };
        queue(reel, "idea", "draft", { breakdown: { ...SAMPLE_BREAKDOWN, url: input.reference }, ideas: SAMPLE_IDEAS });
      } else {
        reel.title = input.topic.slice(0, 80) || "New reel";
        reel.document = { topic: input.topic };
        queue(reel, "idea", "draft", { ideas: SAMPLE_IDEAS });
      }
      reels.set(id, reel);
      return view(id);
    },
    get: async (id) => view(id),
    act: async (id, action: ReelAction) => {
      const reel = reels.get(id)!;
      const doc = reel.document;
      const board = doc.storyboard;
      switch (action.action) {
        case "choose_idea":
          reel.document = { ...doc, idea: action.idea, script: undefined };
          reel.currentStep = "script"; reel.title = action.idea.title;
          queue(reel, "script", "draft", { lines: SAMPLE_SCRIPT, notes: "Check the 1994 study wording before posting." });
          break;
        case "revise_script":
          queue(reel, "script", "revise", { lines: SAMPLE_SCRIPT.map((line, i) => (i === 0 ? { ...line, voice: `${line.voice} (revised)` } : line)), notes: `Changed: ${action.comments}` });
          break;
        case "approve_script":
          if (!doc.script) break;
          reel.document = { ...doc, script: { ...doc.script, approved: true }, look: undefined, storyboard: undefined };
          reel.currentStep = "storyboard";
          queue(reel, "storyboard", "draft", looks(reel.document, doc.brief?.treatment ? 1 : 3));
          break;
        case "back_to_script":
          if (doc.script) reel.document = { ...doc, script: { ...doc.script, approved: false }, look: undefined, storyboard: undefined };
          reel.currentStep = "script";
          break;
        case "choose_look": {
          const chosen = doc.look?.options[action.index];
          if (!chosen || !doc.look) break;
          reel.document = { ...doc, look: { ...doc.look, chosen } };
          queue(reel, "storyboard", "draft", { phase: "scenes", scenes: sampleScenes(chosen), notes: "One image to make; the clock is reused from reel 01." });
          break;
        }
        case "revise_look":
          reel.document = { ...doc, look: { options: doc.look?.options ?? [], rejected: doc.look?.rejected ?? [] } };
          queue(reel, "storyboard", "revise", looks(doc, 1, `Changed: ${action.comments}`));
          break;
        case "more_looks": {
          const rejected = [...new Set([...(doc.look?.rejected ?? []), ...(doc.look?.options ?? []).map((look) => look.name)])];
          reel.document = { ...doc, look: { options: doc.look?.options ?? [], rejected } };
          queue(reel, "storyboard", "draft", looks(reel.document, 3));
          break;
        }
        case "own_look":
          reel.document = { ...doc, look: { options: [], rejected: doc.look?.rejected ?? [] } };
          queue(reel, "storyboard", "draft", { phase: "look", looks: [{ ...SAMPLE_LOOKS[0], name: "Your look", treatment: action.description }] });
          break;
        case "revise_storyboard":
          if (!board || !doc.look?.chosen) break;
          queue(reel, "storyboard", "revise", { phase: "scenes", notes: `Changed: ${action.comments}`, scenes: board.scenes.map((scene) =>
            action.scene && scene.n !== action.scene ? scene : { ...scene, move: `${scene.move} (changed)` }) });
          break;
        case "edit_image_prompt":
          if (board) reel.document = { ...doc, storyboard: { ...board, approved: false, scenes: board.scenes.map((scene) => scene.n !== action.scene ? scene
            : { ...scene, images: scene.images.map((image) => image.file === action.file ? { ...image, prompt: action.prompt } : image) }) } };
          break;
        case "restore_storyboard": {
          const earlier = doc.storyboardHistory?.find((item) => item.version === action.version);
          if (earlier && board) reel.document = { ...doc, storyboard: { ...earlier, approved: false },
            storyboardHistory: [board, ...(doc.storyboardHistory ?? []).filter((item) => item.version !== action.version)] };
          break;
        }
        case "approve_storyboard":
          if (board) { reel.document = { ...doc, storyboard: { ...board, approved: true } }; reel.currentStep = "images"; }
          break;
        case "add_reference":
          reel.document = { ...doc, references: [...new Set([...(doc.references ?? []), action.url])] };
          break;
        case "remove_reference":
          reel.document = { ...doc, references: (doc.references ?? []).filter((item) => item !== action.url) };
          break;
        case "retry":
          break;
      }
      reel.updatedAt = now();
      return view(id);
    },
  };
}
