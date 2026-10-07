import type { ReelAction, ReelJobView, ReelStep, ReelView, ScriptLine } from "@/lib/reels";
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

type MockJob = ReelJobView & { readyAt: number; output: Record<string, unknown> };

export function createMockReelsApi(delayMs = 2500): ReelsApi {
  const reels = new Map<string, Omit<ReelView, "jobs"> & { jobs: MockJob[] }>();
  const now = () => new Date().toISOString();
  const queue = (reel: { jobs: MockJob[] }, step: ReelStep, kind: string, output: Record<string, unknown>) => {
    reel.jobs.unshift({ id: crypto.randomUUID(), step, kind, status: "queued", progress: null, errorCode: null, result: null,
      createdAt: now(), updatedAt: now(), readyAt: Date.now() + delayMs, output });
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
    const script = latest.script;
    const lines = script?.result?.lines as ScriptLine[] | undefined;
    if (script?.status === "needs_review" && lines && !reel.document.script?.approved && reel.document.script?.lines !== lines) {
      reel.document = { ...reel.document, script: { lines, notes: String(script.result?.notes ?? ""), approved: false } };
    }
    return structuredClone({ ...reel, jobs: latest });
  };
  return {
    list: async () => [...reels.values()].map((reel) => ({ id: reel.id, title: reel.title, status: reel.status, currentStep: reel.currentStep, updatedAt: reel.updatedAt })),
    create: async (topic) => {
      const id = crypto.randomUUID();
      const reel = { id, title: topic.slice(0, 80) || "New reel", status: "in_progress", currentStep: "idea" as ReelStep, document: { topic }, updatedAt: now(), jobs: [] as MockJob[] };
      queue(reel, "idea", "draft", { ideas: SAMPLE_IDEAS });
      reels.set(id, reel);
      return view(id);
    },
    get: async (id) => view(id),
    act: async (id, action: ReelAction) => {
      const reel = reels.get(id)!;
      if (action.action === "choose_idea") {
        reel.document = { ...reel.document, idea: action.idea, script: undefined };
        reel.currentStep = "script"; reel.title = action.idea.title;
        queue(reel, "script", "draft", { lines: SAMPLE_SCRIPT, notes: "Check the 1994 study wording before posting." });
      } else if (action.action === "revise_script") {
        queue(reel, "script", "revise", { lines: SAMPLE_SCRIPT.map((line, i) => (i === 0 ? { ...line, voice: `${line.voice} (revised)` } : line)), notes: `Changed: ${action.comments}` });
      } else if (action.action === "approve_script" && reel.document.script) {
        reel.document = { ...reel.document, script: { ...reel.document.script, approved: true } };
        reel.currentStep = "storyboard";
      }
      reel.updatedAt = now();
      return view(id);
    },
  };
}
