import { parseBrief } from "@/lib/reel-brief";
import { earlierLooks, imagesToMake, type ReelBuildVersion, type ReelVoiceTake, type ReelAction, type ReelDocument, type ReelJobView, type ReelLook, type ReelScene, type ReelStep, type ReelUpload, type ReelView, type ScriptLine } from "@/lib/reels";
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
/** A simple sample sketch: the paper, the scene's words, an image slot and a pencil-blue note. */
const escapeXml = (text: string) => text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
export const sampleSketch = (scene: ReelScene) => [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">',
  `<rect width="1080" height="1920" fill="${scene.n % 2 ? "#1F2340" : "#F4EADC"}"/>`,
  `<text x="540" y="520" text-anchor="middle" font-family="Georgia, serif" font-size="96" fill="${scene.n % 2 ? "#F4EADC" : "#321708"}">${escapeXml(scene.codeDraws.slice(0, 18))}</text>`,
  '<rect x="290" y="700" width="500" height="620" rx="24" fill="none" stroke="#B0544C" stroke-width="6" stroke-dasharray="20 14"/>',
  `<text x="540" y="1020" text-anchor="middle" font-family="Helvetica, sans-serif" font-size="32" fill="#B0544C">${escapeXml(scene.images[0]?.file ?? "drawn in code")}</text>`,
  `<text x="120" y="1440" font-family="Georgia, serif" font-style="italic" font-size="40" fill="#4A6FA5">${escapeXml(scene.move.slice(0, 40))}</text>`,
  '<line x1="0" y1="1500" x2="1080" y2="1500" stroke="#4A6FA5" stroke-width="3" stroke-dasharray="12 12" opacity=".5"/>',
  "</svg>",
].join("");

const sampleScenes = (look: ReelLook): ReelScene[] => SAMPLE_SCRIPT.map((line, index) => ({
  n: index + 1, line: line.voice, paper: index % 2 ? "Night #1F2340" : "Cream #F4EADC", codeDraws: line.onScreen,
  move: "Rises in on the stressed word", transition: "The hero object carries into the next scene",
  images: index === 0 ? [{ file: "r02_01_anaika_yawn.png", purpose: "Anaika yawning in her pumpkin costume", aspect: "9:16", background: "transparent" as const,
    reference: "anaika" as const, reuse: "", prompt: `Anaika, a toddler in a pumpkin costume, mid-yawn, in the style of ${look.name.toLowerCase()}.` }]
    : index === 4 ? [{ file: "r02_05_clock.png", purpose: "The clock", aspect: "1:1", background: "transparent" as const, reference: "none" as const,
      reuse: "reel01 clock face with no hands", prompt: "" }] : [],
}));

/** A blob of silence, so the sample takes have something to play (the page's policy allows blob: audio, not data:). */
let silentUrl: string | null = null;
const silentWav = () => {
  if (silentUrl !== null) return silentUrl;
  try {
    const bytes = Uint8Array.from(atob("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="), (char) => char.charCodeAt(0));
    silentUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  } catch {
    silentUrl = "";
  }
  return silentUrl;
};
const sampleTake = (id: string, label: string, gap: number, lines: string[], note?: { n: number; text: string }): ReelVoiceTake => {
  let at = 0;
  const spans = lines.map((text, index) => {
    const start = at, end = at + 2.4 + (index % 3) * 0.4;
    at = end + gap;
    return { n: index + 1, text: note?.n === index + 1 ? note.text : text, start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
  });
  return { id, label, gap, stability: 0.45, objectPath: `sample/voice/${id}-${Date.now()}.mp3`, seconds: spans.at(-1)!.end,
    lines: spans, words: spans.map((span) => ({ n: span.n, word: span.text.replace(/\[[^\]]*\]\s*/g, "").split(" ")[0] || "word", start: span.start, end: span.start + 0.3 })),
    cueCheck: { ok: true, spokenCues: [], heard: 0.97, transcript: "" } };
};

/** A sample build: one still per storyboard scene (its sample sketch stands in for the render). */
const sampleBuild = (doc: ReelDocument, version: number, change?: string) => ({
  phase: "build", reelNo: 3, version, seconds: 21, preview: `sample/build/v${version}.mp4`, commit: `abc${version}def`,
  notes: change ? `Sample build: changed as asked (${change}).` : "Sample build: eight scenes on cream paper, the hook lands on frame 0.",
  stills: (doc.storyboard?.scenes ?? []).map((scene, index) => ({ n: scene.n, t: index * 3 + 1.5, objectPath: `sample/build/v${version}-scene-${scene.n}.jpg` })),
});

const sampleSound = (doc: ReelDocument, version: number, musicDb: number) => ({
  phase: "sound", version, preview: `sample/sound/v${version}.mp4`, musicDb, commit: null, seconds: 21, characters: 120,
  musicPrompt: "Instrumental bed for a 21-second calm, warm story reel. Plucked strings and celesta, ending on a music box.",
  cues: (doc.storyboard?.scenes ?? []).slice(0, 4).map((scene, index) => ({ scene: scene.n, t: index * 3 + 1.2, name: ["pin", "stamp", "paper", "chime"][index], prompt: "a soft paper tap", gainDb: -5 })),
});
const sampleExport = (version: number) => ({
  phase: "export", version, final: `sample/export/v${version}.mp4`, cover: `sample/export/v${version}.jpg`, seconds: 21, bytes: 52_400_000,
  caption: "That Halloween meltdown? It's probably not the sugar.\nMore at mycuratedhaven.com · link in bio\nSave this for Halloween night.",
  hashtags: ["#toddlermom", "#halloweenwithkids", "#gentleparenting"],
});

type MockJob = ReelJobView & { readyAt: number; output: Record<string, unknown> };
type MockReel = Omit<ReelView, "jobs"> & { jobs: MockJob[] };

export function createMockReelsApi(delayMs = 2500): ReelsApi {
  const reels = new Map<string, MockReel>();
  const now = () => new Date().toISOString();
  const queue = (reel: MockReel, step: ReelStep, kind: string, output: Record<string, unknown>) => {
    reel.jobs.unshift({ id: crypto.randomUUID(), step, kind, status: "queued", progress: null, errorCode: null, result: null,
      createdAt: now(), updatedAt: now(), readyAt: Date.now() + delayMs, output });
  };
  const queueSketches = (reel: MockReel, only: number[]) => {
    const storyboard = reel.document.storyboard!;
    queue(reel, "storyboard", "render", { phase: "sketches", version: storyboard.version,
      sketches: storyboard.scenes.filter((scene) => only.includes(scene.n)).map((scene) => ({ n: scene.n, svg: sampleSketch(scene) })) });
  };
  const absorb = (reel: MockReel, latest: ReelView["jobs"]) => {
    for (const key of ["sound", "export"] as const) {
      const done = latest[key];
      const current = reel.document[key] ?? { versions: [] };
      if (reel.currentStep === key && done?.status === "needs_review" && done.result && !current.versions.some((item) => item.jobId === done.id)) {
        reel.document = { ...reel.document, [key]: { ...current, versions: [...current.versions, { ...(done.result as never as object), jobId: done.id }] } };
      }
    }
    const buildJob = latest.build;
    const build = reel.document.build;
    if (reel.currentStep === "build" && build && buildJob?.status === "needs_review" && buildJob.result && !build.versions.some((item) => item.jobId === buildJob.id)) {
      reel.document = { ...reel.document, build: { ...build, approved: false, versions: [...build.versions, { ...(buildJob.result as unknown as ReelBuildVersion), jobId: buildJob.id }] } };
    }
    const voiceJob = latest.voice;
    if (reel.currentStep === "voice" && voiceJob?.status === "needs_review" && voiceJob.result && reel.document.voice?.fromJob !== voiceJob.id) {
      const takes = voiceJob.result.takes as ReelVoiceTake[];
      const current = reel.document.voice;
      reel.document = { ...reel.document, voice: voiceJob.result.phase === "line"
        ? { ...current!, takes: current!.takes.map((take) => takes.find((item) => item.id === take.id) ?? take), fromJob: voiceJob.id, credits: voiceJob.result.credits as never }
        : { takes, fromJob: voiceJob.id, credits: voiceJob.result.credits as never } };
    }
    const doc = reel.document;
    const script = latest.script;
    const lines = script?.result?.lines as ScriptLine[] | undefined;
    if (script?.status === "needs_review" && lines && !doc.script?.approved && doc.script?.lines !== lines) {
      reel.document = { ...doc, script: { lines, notes: String(script.result?.notes ?? ""), approved: false } };
    }
    const board = latest.storyboard;
    if (reel.currentStep !== "storyboard" || board?.status !== "needs_review" || !board.result) return;
    if (board.result.phase === "look" && reel.document.look?.fromJob !== board.id) {
      const options = board.result.looks as ReelLook[];
      const earlier = earlierLooks([...(reel.document.look?.options ?? []), ...(reel.document.look?.earlier ?? [])], options);
      reel.document = { ...reel.document, look: { options, rejected: reel.document.look?.rejected ?? [], fromJob: board.id, earlier } };
    }
    if (board.result.phase === "scenes" && reel.document.storyboard?.fromJob !== board.id) {
      const previous = reel.document.storyboard;
      const scenes = (board.result.scenes as ReelScene[]).map(({ sketch: _sketch, ...scene }) => scene);
      reel.document = { ...reel.document, storyboard: { version: (previous?.version ?? 0) + 1, scenes,
        notes: String(board.result.notes ?? ""), approved: false, fromJob: board.id },
      storyboardHistory: previous ? [previous, ...(reel.document.storyboardHistory ?? [])].slice(0, 5) : reel.document.storyboardHistory };
      queueSketches(reel, scenes.map((scene) => scene.n));
    }
    const storyboard = reel.document.storyboard;
    if (board.result.phase === "sketches" && storyboard && storyboard.sketchesFrom !== board.id && board.result.version === storyboard.version) {
      const drawn = new Map((board.result.sketches as Array<{ n: number; svg: string }>).map((item) => [item.n, item.svg]));
      reel.document = { ...reel.document, storyboard: { ...storyboard, sketchesFrom: board.id,
        scenes: storyboard.scenes.map((scene) => (drawn.has(scene.n) ? { ...scene, sketch: drawn.get(scene.n) } : scene)) } };
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
    // Absorbing can queue a sketch job; list the jobs again so the page sees it and keeps refreshing.
    const jobs: ReelView["jobs"] = {};
    const imageJobs: Record<string, MockJob & { uploadId: string }> = {};
    for (const job of reel.jobs) {
      if (!jobs[job.step]) jobs[job.step] = job;
      const file = job.step === "images" ? String(job.output.file) : null;
      if (file && !imageJobs[file]) imageJobs[file] = { ...job, uploadId: String(job.output.uploadId) };
    }
    // The sample runner's image checks fold into the uploads they were made for.
    for (const job of Object.values(imageJobs)) {
      const upload = reel.document.images?.[String(job.output.file)];
      if (upload && job.status === "needs_review" && upload.uploadId === job.uploadId && upload.review.jobId !== job.id) {
        reel.document = { ...reel.document, images: { ...reel.document.images, [upload.file]: { ...upload,
          review: { status: job.output.verdict as "good" | "redo", notes: String(job.output.notes), jobId: job.id } } } };
      }
    }
    return structuredClone({ ...reel, jobs, imageJobs, imageUrls: Object.fromEntries(Object.keys(reel.document.images ?? {}).map((file) => [file, previews.get(`${id}/${file}`) ?? ""])),
      voiceUrls: Object.fromEntries((reel.document.voice?.takes ?? []).map((take) => [take.id, silentWav()])),
      soundUrl: reel.document.sound?.versions.length ? "" : undefined,
      exportUrls: reel.document.export?.versions.length ? { cover: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSketch((reel.document.storyboard?.scenes ?? [])[0] ?? { n: 1, line: "", paper: "", codeDraws: "Cover", move: "", transition: "", images: [] }))}` } : undefined,
      buildUrls: reel.document.build?.versions.length ? { stills: Object.fromEntries((reel.document.storyboard?.scenes ?? []).map((scene) =>
        [scene.n, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSketch(scene))}`])) } : undefined });
  };
  const looks = (doc: ReelDocument, count: number, note?: string) => ({ phase: "look", looks: (doc.brief?.treatment && count === 1
    ? [{ ...SAMPLE_LOOKS[0], name: "Your treatment", treatment: doc.brief.treatment }]
    : SAMPLE_LOOKS.filter((look) => !doc.look?.rejected.includes(look.name)).concat(SAMPLE_LOOKS).slice(0, count))
    .map((look) => (note ? { ...look, why: note } : look)) });
  /** Sample uploads: the browser's own copy of the file stands in for storage. */
  const pending = new Map<string, File>();
  const previews = new Map<string, string>();
  const reviewImage = (reel: MockReel, upload: ReelUpload) => queue(reel, "images", "draft", { phase: "review", file: upload.file, uploadId: upload.uploadId,
    verdict: upload.checks.some((check) => check.level === "fail") ? "redo" : "good",
    notes: upload.checks.some((check) => check.level === "fail") ? "Sample check: the background should be transparent." : "Sample check: matches the prompt and the look." });
  return {
    startImageUpload: async (id, input) => {
      const uploadId = crypto.randomUUID();
      return { uploadId, uploadUrl: `https://mock.storage/upload/${id}/${encodeURIComponent(input.file)}/${uploadId}` };
    },
    uploadImage: async (uploadUrl, file, onProgress) => { onProgress(0.5); pending.set(uploadUrl.split("/").pop()!, file); onProgress(1); },
    finishImageUpload: async (id, input) => {
      const reel = reels.get(id)!;
      const file = pending.get(input.uploadId);
      const image = imagesToMake(reel.document.storyboard).find((item) => item.file === input.file);
      if (!file || !image) throw new Error("The upload didn't finish. Upload the image again.");
      const transparent = file.type !== "image/jpeg";
      const upload: ReelUpload = { file: input.file, uploadId: input.uploadId, objectPath: `sample/${input.file}`, mime: file.type, bytes: file.size,
        width: 1080, height: 1350, sha256: "sample", uploadedAt: new Date().toISOString(), review: { status: "pending", notes: "" },
        checks: [{ code: "size", level: "ok", message: "1080×1350 px (sample)." },
          ...(image.background === "transparent" ? [transparent ? { code: "transparent", level: "ok" as const, message: "Transparent background, as asked." }
            : { code: "transparent", level: "fail" as const, message: "Needs a transparent background. Save it as a PNG or WebP with transparency." }] : [])] };
      reel.document = { ...reel.document, images: { ...reel.document.images, [input.file]: upload } };
      try { previews.set(`${id}/${input.file}`, URL.createObjectURL(file)); } catch { previews.set(`${id}/${input.file}`, ""); }
      reviewImage(reel, upload);
      return view(id);
    },
    removeImage: async (id, file) => {
      const reel = reels.get(id)!;
      const { [file]: _gone, ...images } = reel.document.images ?? {};
      reel.document = { ...reel.document, images };
      return view(id);
    },
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
          const chosen = (action.earlier ? doc.look?.earlier : doc.look?.options)?.[action.index];
          if (!chosen || !doc.look) break;
          reel.document = { ...doc, look: { ...doc.look, chosen, earlier: earlierLooks([doc.look.chosen, ...(doc.look.earlier ?? [])], [chosen]) } };
          queue(reel, "storyboard", "draft", { phase: "scenes", scenes: sampleScenes(chosen), notes: "One image to make; the clock is reused from reel 01." });
          break;
        }
        case "revise_look":
          reel.document = { ...doc, look: { options: doc.look?.options ?? [], rejected: doc.look?.rejected ?? [], earlier: earlierLooks([doc.look?.chosen, ...(doc.look?.earlier ?? [])]) } };
          queue(reel, "storyboard", "revise", looks(doc, 1, `Changed: ${action.comments}`));
          break;
        case "more_looks": {
          const rejected = [...new Set([...(doc.look?.rejected ?? []), ...(doc.look?.options ?? []).map((look) => look.name)])];
          reel.document = { ...doc, look: { options: doc.look?.options ?? [], rejected, earlier: earlierLooks([doc.look?.chosen, ...(doc.look?.earlier ?? [])]) } };
          queue(reel, "storyboard", "draft", looks(reel.document, 3));
          break;
        }
        case "own_look":
          reel.document = { ...doc, look: { options: doc.look?.options ?? [], rejected: doc.look?.rejected ?? [], earlier: earlierLooks([doc.look?.chosen, ...(doc.look?.earlier ?? [])]) } };
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
        case "redraw_sketches":
          if (board) queueSketches(reel, action.scene ? [action.scene] : board.scenes.map((scene) => scene.n));
          break;
        case "approve_storyboard":
          if (board) { reel.document = { ...doc, storyboard: { ...board, approved: true } }; reel.currentStep = "images"; }
          break;
        case "recheck_image": {
          const upload = doc.images?.[action.file];
          if (upload) { reel.document = { ...doc, images: { ...doc.images, [action.file]: { ...upload, review: { status: "pending", notes: "" } } } }; reviewImage(reel, upload); }
          break;
        }
        case "continue_images": {
          reel.currentStep = "voice";
          const lines = (doc.script?.lines ?? []).map((line) => line.voice);
          if (!doc.voice) queue(reel, "voice", "draft", { phase: "takes", credits: { used: 412, remaining: 38_398, limit: 40_000 },
            takes: [sampleTake("a", "Natural", 0.3, lines), sampleTake("b", "Tight", 0.2, lines)] });
          break;
        }
        case "choose_take":
          if (doc.voice) reel.document = { ...doc, voice: { ...doc.voice, chosen: action.take, approved: false } };
          break;
        case "redo_line": {
          const take = doc.voice?.takes.find((item) => item.id === action.take);
          const lines = (doc.script?.lines ?? []).map((line) => line.voice);
          if (take) queue(reel, "voice", "revise", { phase: "line", credits: { used: 48, remaining: 38_350, limit: 40_000 },
            takes: [sampleTake(take.id, take.label, take.gap, lines, { n: action.n, text: `[${action.note}] ${lines[action.n - 1]?.replace(/^\[[^\]]*\]\s*/, "") ?? ""}` })] });
          break;
        }
        case "new_takes": {
          const lines = (doc.script?.lines ?? []).map((line) => line.voice);
          reel.document = { ...doc, voice: { takes: doc.voice?.takes ?? [] } };
          queue(reel, "voice", "draft", { phase: "takes", credits: { used: 412, remaining: 37_986, limit: 40_000 },
            takes: [sampleTake("a", "Natural", 0.3, lines), sampleTake("b", "Tight", 0.2, lines)] });
          break;
        }
        case "approve_voice":
          if (doc.voice?.chosen) {
            reel.document = { ...doc, voice: { ...doc.voice, approved: true }, build: { reelNo: 3, versions: [] } };
            reel.currentStep = "build";
            queue(reel, "build", "draft", sampleBuild(reel.document, 1));
          }
          break;
        case "revise_build":
        case "rebuild":
          if (doc.build) queue(reel, "build", action.action === "rebuild" ? "draft" : "revise",
            sampleBuild(doc, doc.build.versions.length + 1, action.action === "revise_build" ? action.comments : undefined));
          break;
        case "approve_build":
          if (doc.build?.versions.length) {
            reel.document = { ...doc, build: { ...doc.build, approved: true } };
            reel.currentStep = "sound";
            queue(reel, "sound", "draft", sampleSound(reel.document, 1, -9));
          }
          break;
        case "new_music":
        case "change_sounds":
        case "music_level": {
          const latestSound = doc.sound?.versions.at(-1);
          queue(reel, "sound", "revise", sampleSound(doc, (doc.sound?.versions.length ?? 0) + 1, action.action === "music_level" ? action.db : latestSound?.musicDb ?? -9));
          break;
        }
        case "approve_sound":
          if (doc.sound?.versions.length) {
            reel.document = { ...doc, sound: { ...doc.sound, approved: true } };
            reel.currentStep = "export";
            queue(reel, "export", "render", sampleExport(1));
          }
          break;
        case "export_again":
          queue(reel, "export", "render", sampleExport((doc.export?.versions.length ?? 0) + 1));
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
