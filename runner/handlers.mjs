// What the runner does for each reel step. Thinking steps call Claude Code on this Mac (`claude -p`, your login);
// mechanical steps will run plain scripts. Steps not built yet fail clearly instead of guessing.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pullBoards, splitReferences } from "./arena.mjs";
import { voiceJob } from "./voice.mjs";

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Runs Claude Code once and returns its text answer. With no `tools` it gets none and one turn. `tools` names
 * the only built-in tools it may use (for example "Read" to look at frames in `cwd`, "WebFetch" to open a link).
 * `effort` ("low" … "max") trades thinking for speed; sketches use "low".
 */
export function askClaude(prompt, { timeoutMs = 180_000, tools = [], maxTurns, cwd, effort } = {}) {
  return new Promise((resolve, reject) => {
    const dir = cwd ?? mkdtempSync(join(tmpdir(), "tiny-soho-runner-"));
    const toolArgs = tools.length
      ? ["--tools", tools.join(","), "--allowedTools", tools.join(","), "--max-turns", String(maxTurns ?? 12)]
      : ["--max-turns", "1", "--allowedTools", ""];
    const effortArgs = effort ? ["--effort", effort] : [];
    const child = spawn("claude", ["-p", prompt, "--output-format", "json", ...toolArgs, ...effortArgs], { cwd: dir });
    let out = "", err = "";
    const minutes = Math.round(timeoutMs / 60_000);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(stepError("claude_timeout", `Claude Code took longer than ${minutes} minute${minutes === 1 ? "" : "s"}. Try again.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(stepError("claude_unavailable", `Could not start Claude Code: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(stepError("claude_failed", (err || out).trim().slice(0, 200) || `claude exited with ${code}`));
      try { resolve(JSON.parse(out).result ?? ""); } catch { resolve(out); }
    });
  });
}

/** Runs a command and resolves with its stdout and stderr; rejects with `code` when it fails. */
function run(command, args, { cwd, timeoutMs = 120_000, code = "tool_failed" } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(stepError(code, `${command}: ${(stderr || error.message).trim().slice(-180)}`));
      resolve({ stdout, stderr });
    });
  });
}

function jsonIn(text, open, what) {
  const close = open === "[" ? "]" : "}";
  const start = text.indexOf(open), end = text.lastIndexOf(close);
  if (start < 0 || end < start) throw stepError("claude_bad_output", `Claude did not return ${what}.`);
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw stepError("claude_bad_output", `Claude returned ${what} that could not be read.`); }
}

const str = (value, max) => String(value ?? "").trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

function parseIdeas(text) {
  const ideas = list(jsonIn(text, "[", "a list")).slice(0, 3).map((idea) => ({
    title: str(idea.title, 120), hook: str(idea.hook, 200), why: str(idea.why, 300),
  })).filter((idea) => idea.title);
  if (!ideas.length) throw stepError("claude_bad_output", "Claude did not return any ideas.");
  return ideas;
}

/** House rules for every Tiny Soho script, from the first reel ("It's Not the Sugar"). */
const SCRIPT_RULES = [
  "Tiny Soho is a calm, realistic parenting account for US moms of toddlers. Voice: a warm mom narrator.",
  "Length: 20-30 seconds spoken, about 55-75 words, 6-9 lines. US spelling.",
  "Line 1 is the hook: a clear, surprising claim a viewer understands in the first 2 seconds.",
  "Shape: conflict, then one big question, then the twist, then one easy thing to do.",
  "Every line gets one matching visual (onScreen), short enough to read on a phone.",
  "Voice cues in square brackets go just before the words they change: [curious] [pause] [warmly] [softly] [whispers] [slowly] [excited] [mischievously] [matter-of-fact] [brisk]. CAPITALS stress one word. No <break> tags.",
  "No shaming of kids, parents or food. No medical advice. Only widely established facts; hedge anything uncertain with 'probably'.",
  "End with a save prompt tied to a future moment (for example 'Save this for Halloween night').",
].join("\n");

const scriptAnswer = 'Answer with only JSON: {"lines": [{"time": "0:00", "voice": string, "onScreen": string}], "notes": string}. '
  + "Times are estimates in m:ss. notes: one sentence on any fact a person should double-check.";

export function parseScript(text) {
  const data = jsonIn(text, "{", "a script");
  const lines = list(data.lines).slice(0, 20).map((line) => ({
    time: str(line.time, 12), voice: str(line.voice, 400), onScreen: str(line.onScreen, 200),
  })).filter((line) => line.voice);
  if (!lines.length) throw stepError("claude_bad_output", "The script came back empty.");
  return { lines, notes: str(data.notes, 500) };
}

/** The brief as plain lines for a prompt, without the raw paste. */
function briefText(brief) {
  if (!brief) return "";
  const { raw: _raw, scriptDraft, facts, ...fields } = brief;
  const lines = Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`);
  if (facts?.length) lines.push("facts:", ...facts.map((fact) => `- ${fact.claim} (source: ${fact.source || "none given"})`));
  if (scriptDraft?.length) lines.push("script draft:", ...scriptDraft.map((line, i) => `${i + 1}. ${line.voice} | ${line.onScreen}`));
  return lines.join("\n");
}

/**
 * Time limits for the thinking steps. Look and storyboard prompts carry the whole motion library, and a storyboard
 * writes every scene and image prompt in one answer, so they get longer than ideas and scripts (3 minutes).
 */
export const LOOK_TIMEOUT_MS = 5 * 60_000;
export const STORYBOARD_TIMEOUT_MS = 10 * 60_000;

const handlers = {
  /** Idea, first draft: three story ideas for the topic, or a breakdown of a reference reel plus three angles. */
  "idea/draft": async (job, reel, tools) => {
    if (job.input.reference) return referenceBreakdown(String(job.input.reference), tools);
    await tools.progress("Asking Claude for three story ideas");
    const topic = str(job.input.topic ?? reel?.title, 400);
    const text = await askClaude([
      "You write story ideas for @tinysoho, a calm, realistic parenting account (mostly US moms of toddlers).",
      "Give three ideas for a 20-30 second motion-graphics story reel. No recipes, no shaming, no medical advice.",
      `Topic: ${topic || "anything timely for parents of toddlers"}`,
      'Answer with only a JSON array of 3 objects: {"title": string, "hook": string, "why": string}.',
    ].join("\n"));
    return { status: "needs_review", result: { ideas: parseIdeas(text) }, progress: "Three ideas ready for review" };
  },
};

/**
 * Breaks down someone else's reel: downloads it, makes contact sheets (one frame a second) and a list of cut
 * times, transcribes the voice when it can, then has Claude read the sheets and transcript together.
 * Everything stays in a temp folder on this Mac and is deleted afterwards.
 */
async function referenceBreakdown(link, { progress }) {
  const dir = mkdtempSync(join(tmpdir(), "tiny-soho-reference-"));
  try {
    await progress("Downloading the reference reel");
    await run("yt-dlp", ["--no-playlist", "--max-filesize", "200M", "-f", "mp4/best", "-o", "reel.%(ext)s", link],
      { cwd: dir, timeoutMs: 180_000, code: "reference_download_failed" });
    const video = readdirSync(dir).find((name) => name.startsWith("reel."));
    if (!video) throw stepError("reference_download_failed", "The reel could not be downloaded. It may be private.");

    await progress("Pulling frames and cuts");
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { cwd: dir });
    const duration = Math.min(Number.parseFloat(probe.stdout) || 0, 180);
    if (!duration) throw stepError("reference_unreadable", "The downloaded file has no video.");
    await run("ffmpeg", ["-v", "error", "-t", "180", "-i", video, "-vf", "fps=1,scale=240:-2,tile=4x3", "sheet_%02d.jpg"], { cwd: dir });
    const cuts = await run("ffmpeg", ["-t", "180", "-i", video, "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"], { cwd: dir })
      .then(({ stderr }) => [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]).toFixed(1)))
      .catch(() => []);

    await progress("Transcribing the voice");
    const transcript = await transcribe(dir, video);

    await progress("Claude is studying the reel");
    const sheets = readdirSync(dir).filter((name) => name.startsWith("sheet_")).sort().slice(0, 15);
    const text = await askClaude([
      "You study short-form reels for @tinysoho, a calm, realistic parenting account (mostly US moms of toddlers).",
      `The files ${sheets.join(", ")} in this folder are contact sheets of a ${duration.toFixed(1)} s reel: 12 frames each, one per second,`,
      "left to right, top to bottom, so sheet_01 shows seconds 0-11 and sheet_02 seconds 12-23. Read every sheet.",
      `Scene cuts at (seconds): ${cuts.slice(0, 80).join(", ") || "none detected"}.`,
      `Voice transcript: ${transcript ? transcript.slice(0, 4000) : "not available"}.`,
      "",
      "Break it down so we can learn from it without copying it. Then pitch three Tiny Soho story reels (20-30 s,",
      "motion graphics, no recipes, no shaming, no medical advice) that borrow what works.",
      'Answer with only JSON: {"breakdown": {"summary": string, "hook": string, "hookSeconds": number, "pacing": string,',
      '"structure": string, "textStyle": string, "emotion": string, "works": [string], "borrow": [string], "avoid": [string]},',
      '"ideas": [{"title": string, "hook": string, "why": string}]}.',
      "works: why it holds attention. borrow: structure, pacing or techniques we can use. avoid: what would be copying",
      "(their script, characters, music, exact visuals) or off-brand.",
    ].join("\n"), { cwd: dir, tools: ["Read"], maxTurns: 25, timeoutMs: 300_000 });
    const data = jsonIn(text, "{", "a breakdown");
    const b = data.breakdown ?? {};
    const strings = (value) => list(value).slice(0, 6).map((item) => str(item, 200)).filter(Boolean);
    const breakdown = {
      url: link, seconds: Math.round(duration * 10) / 10, cuts: cuts.length,
      summary: str(b.summary, 400), hook: str(b.hook, 300), hookSeconds: Number(b.hookSeconds) || null,
      pacing: str(b.pacing, 300), structure: str(b.structure, 400), textStyle: str(b.textStyle, 300), emotion: str(b.emotion, 200),
      works: strings(b.works), borrow: strings(b.borrow), avoid: strings(b.avoid), transcript: transcript ? transcript.slice(0, 2000) : "",
    };
    return { status: "needs_review", result: { breakdown, ideas: parseIdeas(JSON.stringify(data.ideas ?? [])) }, progress: "Breakdown ready" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Speech to text with faster-whisper through uv. Returns "" when it isn't available, so the breakdown still runs. */
export async function transcribe(dir, video) {
  try {
    await run("ffmpeg", ["-v", "error", "-t", "180", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "voice.wav"], { cwd: dir });
    // Samples go in as an array: faster-whisper's own file decoding breaks with some PyAV versions.
    writeFileSync(join(dir, "stt.py"), [
      "import wave, numpy as np",
      "from faster_whisper import WhisperModel",
      "with wave.open('voice.wav') as f: audio = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768",
      "segments, _ = WhisperModel('base', compute_type='int8').transcribe(audio)",
      "print(' '.join(s.text.strip() for s in segments))",
    ].join("\n"));
    const { stdout } = await run("uv", ["run", "--quiet", "--with", "faster-whisper", "python", "stt.py"], { cwd: dir, timeoutMs: 300_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

handlers["script/draft"] = async (job, reel, { progress }) => {
  const brief = job.input.brief ?? null;
  if (brief && job.input.keepScript) {
    await progress("Claude is timing and checking your script");
    const text = await askClaude([SCRIPT_RULES, "", "The creator wrote this brief, with a script draft:", briefText(brief), "",
      "Keep their wording. Only add times, add a short onScreen visual where one is missing, and keep their voice cues.",
      "Do not rewrite lines. In notes, list any rule the draft breaks (length, a slow hook, an unsourced claim, a missing",
      "save prompt) in one or two short sentences, or say it follows the rules.", scriptAnswer].join("\n"));
    return { status: "needs_review", result: parseScript(text), progress: "Your script, timed and checked" };
  }
  await progress("Claude is writing the script");
  const idea = job.input.idea ?? {};
  const text = await askClaude([SCRIPT_RULES, "",
    ...(brief ? ["The creator's brief:", briefText(brief)] : [`Idea: ${idea.title ?? ""}`, `Hook: ${idea.hook ?? ""}`, `Why it works: ${idea.why ?? ""}`,
      `Original topic: ${str(job.input.topic, 400)}`]),
    "", "Write the reel script.", scriptAnswer].join("\n"));
  return { status: "needs_review", result: parseScript(text), progress: "Script ready for review" };
};

handlers["script/revise"] = async (job, reel, { progress }) => {
  await progress("Claude is changing the script");
  const text = await askClaude([SCRIPT_RULES, "", `Idea: ${job.input.idea?.title ?? ""}`, "Current script (JSON):",
    JSON.stringify(job.input.lines ?? []), "", `The creator asks: ${str(job.input.comments, 1000)}`,
    "Change only what they ask; keep everything else.", scriptAnswer].join("\n"));
  return { status: "needs_review", result: parseScript(text), progress: "Revised script ready for review" };
};

/**
 * The motion library (runner/motion-library.md): styles sorted for the brand, treatments, moves and transitions
 * collected from prompt-motion.com and motionin.design. Read on every look and storyboard job, so the Mac draws
 * on it without the creator pasting links.
 */
export const MOTION_LIBRARY = (() => {
  try { return readFileSync(new URL("./motion-library.md", import.meta.url), "utf8"); } catch { return ""; }
})();

/** The look rules: brand constants and series themes (docs/reels/claude-project/04). Treatments come from the library. */
const LOOK_RULES = [
  "Every Tiny Soho reel has three layers.",
  "Brand (never changes): Fraunces and Inter type, one rose (#B0544C) italic emphasis word per line, a warm mom narrator,",
  "the AI-generated cast Anaika (a toddler) and her mum, a calm kind tone, calm editorial motion (rises, slides, pops,",
  "stamps, slow push-ins; never wiggles, hops or bounces), and the Tiny Soho heart lockup end card.",
  "Series theme (shared by a series): world and mood, one accent colour, 2-3 recurring motifs, a sound signature.",
  "- Halloween, 'Halloween at Anaika's': the evening of 31 Oct, cosy with a little spook; pumpkin glow #E8833A (illustrations",
  "  only) on night #1F2340; motifs: Anaika's pumpkin costume, the porch light and doorbell, the clock that becomes the moon;",
  "  sound: plucked strings and celesta, ending on a music box.",
  "- Sleep, 'After lights out': bedtime and the night after; moonlight cream #F4EADC on night #161A33; motifs: the moon,",
  "  the bedroom door with a strip of hall light, the clock; sound: soft felt piano.",
  "- Myths, 'Myth or not': the evidence desk, curious and fair; sage #3F5A47 for the verdict; motifs: the MYTH / TRUE /",
  "  IT DEPENDS stamp, a source line under every claim, a rating meter; sound: light pizzicato and a firm stamp.",
  "- Standalone: brand layer only.",
  "Reel treatment (fresh every reel, never repeated inside a series): a style, a treatment, moves and transitions,",
  "and one signature moment. Pick them from the motion library below; combining entries is welcome. Never use a",
  "style the library marks off-brand. A fresh idea outside the library is welcome if the engine can draw it in code.",
  "The reel is 9:16, 20-30 s, one scene per script line, drawn in code (three.js and canvas) with a few AI images",
  "for the cast and print-style objects.",
].join("\n");

const lookAnswer = (count) => `Answer with only a JSON array of ${count} object${count > 1 ? "s" : ""}: {"name": string (2-4 words),`
  + ' "treatment": string (one sentence on what the viewer sees, then the library style and treatment in brackets), "emotion": string, "accent": string (one colour name and hex), "signatureMoment": string,'
  + ' "music": string, "why": string (one sentence: why it suits this story)}.';

export function parseLooks(text) {
  const looks = list(jsonIn(text, "[", "a list of looks")).slice(0, 3).map((look) => ({
    name: str(look.name, 80), treatment: str(look.treatment, 800), emotion: str(look.emotion, 200), accent: str(look.accent, 120),
    signatureMoment: str(look.signatureMoment, 600), music: str(look.music, 300), why: str(look.why, 400),
  })).filter((look) => look.name);
  if (!looks.length) throw stepError("claude_bad_output", "Claude did not return any looks.");
  return looks;
}

/** The images every reel may reuse instead of making new ones (made for reel 01). */
const REUSABLE = "reel01 kraft paper texture, reel01 night-blue paper texture, reel01 moon, reel01 clock face with no hands,"
  + " reel01 mask, reel01 doorbell, reel01 candies, reel01 party cup, reel01 Anaika grumpy pout (pumpkin costume),"
  + " reel01 Anaika curious (pumpkin costume), reel01 Anaika asleep with Mum (pumpkin costume)";

const STORYBOARD_RULES = [
  "One scene per script line. Each scene: the line, its paper or background colour, what code draws, the one signature",
  "move (landing on a spoken word), and the transition into the next scene through an object, not a plain cut.",
  "Take moves and transitions from the motion library and name them (for example 'Marker draw-on', 'Object carry').",
  "Images: only what code cannot draw well, which means the cast (Anaika, her mum) and print-style objects. Type, shapes,",
  "stamps, meters, labels, charts, lines and effects are code. Put several small objects on one sheet image where you can.",
  `Reuse an existing image when it fits; set "reuse" to its name and leave the prompt short. Reusable: ${REUSABLE}.`,
  "For each new image write a prompt someone can paste into Gemini, Seedream or Higgsfield: subject, pose, framing,",
  "and the treatment's medium and texture, ending with the brand colours to stay near. Gentle poses only (a pout, never",
  "distress). Characters on a transparent background unless the treatment needs a scene. Set reference to anaika or mum",
  "when that character appears, so the creator attaches the character sheet.",
  "Filenames: rNN_short_name.png in lowercase with underscores; use the scene number in the name.",
].join("\n");

const storyboardAnswer = 'Answer with only JSON: {"scenes": [{"n": number, "line": string, "paper": string, "codeDraws": string,'
  + ' "move": string, "transition": string, "images": [{"file": string, "purpose": string, "prompt": string,'
  + ' "aspect": "9:16" | "1:1" | "4:5" | "16:9", "background": "transparent" | "opaque", "reference": "anaika" | "mum" | "none",'
  + ' "reuse": string}]}], "notes": string}. notes: one or two sentences on anything the creator should decide.';

export function parseStoryboard(text) {
  const data = jsonIn(text, "{", "a storyboard");
  const aspect = (value) => (["9:16", "1:1", "4:5", "16:9"].includes(value) ? value : "9:16");
  const scenes = list(data.scenes).slice(0, 20).map((scene, index) => ({
    n: Number.isInteger(scene.n) && scene.n > 0 && scene.n <= 20 ? scene.n : index + 1,
    line: str(scene.line, 400), paper: str(scene.paper, 80), codeDraws: str(scene.codeDraws, 400),
    move: str(scene.move, 300), transition: str(scene.transition, 300),
    images: list(scene.images).slice(0, 6).map((image) => ({
      file: str(image.file, 80).replace(/[^a-z0-9_.-]/gi, "_").toLowerCase(), purpose: str(image.purpose, 200), prompt: str(image.prompt, 1200),
      aspect: aspect(image.aspect), background: image.background === "opaque" ? "opaque" : "transparent",
      reference: ["anaika", "mum"].includes(image.reference) ? image.reference : "none", reuse: str(image.reuse, 120),
    })).filter((image) => image.file),
  }));
  if (!scenes.length) throw stepError("claude_bad_output", "The storyboard came back empty.");
  return { scenes, notes: str(data.notes, 600) };
}

function storyContext(input, refs) {
  const lines = list(input.script).map((line, i) => `${i + 1}. [${line.time}] ${line.voice} | ${line.onScreen}`);
  return [
    input.brief ? `Brief:\n${briefText(input.brief)}` : `Idea: ${input.idea?.title ?? ""}: ${input.idea?.hook ?? ""}`,
    "Approved script:", ...lines,
    ...(refs.other.length ? [`Reference links from the creator (open them with WebFetch if useful): ${refs.other.join(" ")}`] : []),
    ...(refs.boardText ? ["The creator's Are.na moodboard, downloaded into this folder (read every image with Read before deciding; take mood,",
      "colour, texture and composition from it, never copy a picture):", refs.boardText] : []),
  ].join("\n");
}

/** Links the creator gave: reference links, plus any link in a described look or a comment. */
function referenceLinks(input) {
  const typed = `${input.own ?? ""} ${input.comments ?? ""}`.match(/https?:\/\/[^\s)]+/g) ?? [];
  return splitReferences([...list(input.references), ...typed]);
}

/** Look and storyboard jobs. Are.na boards among the references are downloaded first so Claude can look at them. */
async function storyboardJob(job, reel, tools) {
  const { boards, other } = referenceLinks(job.input);
  if (!boards.length) return storyboardWork(job, tools, { other, boardText: "", files: [], dir: undefined });
  const dir = mkdtempSync(join(tmpdir(), "tiny-soho-board-"));
  try {
    await tools.progress(`Reading your Are.na board${boards.length > 1 ? "s" : ""}`);
    const board = await pullBoards(boards, dir, { run });
    return await storyboardWork(job, tools, { other, boardText: board.text, files: board.files, dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function storyboardWork(job, { progress }, refs) {
  const input = job.input;
  const options = (timeoutMs) => ({
    cwd: refs.dir, timeoutMs, maxTurns: refs.files.length ? 8 + refs.files.length : 8,
    tools: [...(refs.files.length ? ["Read"] : []), ...(refs.other.length ? ["WebFetch"] : [])],
  });
  if (input.phase === "look") {
    const count = Math.min(Math.max(Number(input.count) || 3, 1), 3);
    await progress(count > 1 ? "Claude is suggesting looks (usually about a minute)" : "Claude is shaping the look (usually about a minute)");
    const ask = input.own ? `The creator describes the look they want: ${str(input.own, 1000)}. Turn it into one look.`
      : input.current ? `Current look (JSON): ${JSON.stringify(input.current)}\nThe creator asks: ${str(input.comments, 1000)}. Change only what they ask.`
        : input.brief?.treatment ? `The brief already names the treatment. Turn it into one full look and keep its idea.`
          : `Suggest ${count} looks that differ from each other and suit the story's emotion.`;
    const text = await askClaude([LOOK_RULES, "", MOTION_LIBRARY, "", storyContext(input, refs), "",
      `Series: ${input.series || "standalone (or infer it from the story)"}.`,
      `Treatments already used in this series (do not repeat): ${list(input.seriesUsed).join("; ") || "none"}.`,
      `Looks the creator rejected for this reel (do not suggest again): ${list(input.avoid).join("; ") || "none"}.`,
      "", ask, lookAnswer(count)].join("\n"), options(LOOK_TIMEOUT_MS));
    return { status: "needs_review", result: { phase: "look", looks: parseLooks(text) }, progress: count > 1 ? "Looks ready to choose from" : "Look ready" };
  }
  const revising = job.kind === "revise";
  await progress(revising ? "Claude is changing the storyboard (usually 2–5 minutes)" : "Claude is writing the storyboard (usually 3–6 minutes)");
  const target = input.image ? `Change only the image ${str(input.image, 80)}.` : input.scene ? `Change only scene ${input.scene}.` : "Change only what they ask.";
  const text = await askClaude([LOOK_RULES, "", MOTION_LIBRARY, "", STORYBOARD_RULES, "", storyContext(input, refs), "",
    `The approved look (JSON): ${JSON.stringify(input.look)}. Every scene and image prompt follows this treatment.`,
    ...(revising ? ["", `Current storyboard (JSON): ${JSON.stringify(input.storyboard)}`, `The creator asks: ${str(input.comments, 1000)}`,
      `${target} Keep everything else exactly as it is.`] : ["", "Write the storyboard."]),
    storyboardAnswer].join("\n"), options(STORYBOARD_TIMEOUT_MS));
  return { status: "needs_review", result: { phase: "scenes", ...parseStoryboard(text) }, progress: "Storyboard ready for review" };
}
handlers["storyboard/draft"] = storyboardJob;
handlers["storyboard/revise"] = storyboardJob;

/** Time for one scene's sketch. Scenes are drawn a few at a time. */
export const SKETCH_TIMEOUT_MS = 3 * 60_000;
const SKETCH_AT_ONCE = 3;
const SKETCH_MAX = 16_000;

const SKETCH_RULES = [
  "Draw one storyboard frame as a single SVG: a rough but clear sketch of how this scene will look on screen, so the",
  "creator can judge layout and staging before anything is built. It is a sketch, not finished art.",
  'Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">. 9:16.',
  "Paint the scene's paper or background colour first. Keep everything that must be read inside x 90-990, y 220-1500:",
  "Instagram covers the bottom 420 px and the right 90 px. Draw a faint dashed line at y 1500 labelled 'caption zone'.",
  "On-screen words: only the words 'codeDraws' says appear on screen, drawn as they will appear, large, in",
  "font-family=\"Fraunces, Georgia, serif\" (labels in font-family=\"Inter, Helvetica, Arial, sans-serif\"), with the one",
  "emphasis word in rose #B0544C italic. The voiceover ('line') is heard, not shown: never draw it, and never draw",
  "voice cues in square brackets such as [pause] or [curious].",
  "Images the scene uses: a rounded rectangle where each image sits, with a simple shape hinting at its content (a",
  "child silhouette, a plate, a pin) and its filename in small Inter text inside. Mark reused images 'reuse'.",
  "Things code draws (cards, meters, stamps, string, clocks): simple flat shapes in the look's colours.",
  "Motion: draw the scene's move and its transition into the next scene as annotations in pencil blue #4A6FA5: dashed",
  "arrows, a small motion line, and two or three short notes in italic serif, taken from this scene's own 'move' and",
  "'transition' (name the spoken word the move lands on). Notes are read at phone size: font-size 36 or more, on",
  "a clear area, never on top of other text. Headline words at font-size 80 or more.",
  "Brand colours: cocoa #321708, cream #F4EADC, rose #B0544C, gold #F3C46B, night #1F2340, sage #3F5A47, pumpkin #E8833A.",
  "Allowed elements only: svg, g, defs, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, marker,",
  "linearGradient, radialGradient, stop, pattern, clipPath, title. No script, image, use, foreignObject, links, href,",
  "event attributes, CSS imports or external fonts. Under 60 elements and under 12,000 characters.",
  "Answer with only the SVG, starting with <svg and ending with </svg>.",
].join("\n");

/** Pulls the SVG out of Claude's answer and refuses anything that could run or load something. */
export function parseSketch(text) {
  const start = text.indexOf("<svg"), end = text.lastIndexOf("</svg>");
  if (start < 0 || end < start) throw stepError("claude_bad_output", "Claude did not return a sketch.");
  const svg = text.slice(start, end + 6).trim();
  if (svg.length > SKETCH_MAX) throw stepError("sketch_too_large", "The sketch came back too large.");
  if (/<(script|foreignObject|image|iframe|object|embed|use)\b|\bon[a-z]+\s*=|(xlink:)?href\s*=|@import|url\(\s*['"]?(https?:|\/\/|data:)/i.test(svg)) {
    throw stepError("sketch_unsafe", "The sketch used something that isn't allowed.");
  }
  return svg;
}

/** Runs `work` over `items` with at most `limit` at a time, keeping the order of results. */
async function inBatches(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index], index); }
  }));
  return results;
}

/**
 * Storyboard sketches: one SVG frame per scene, drawn a few scenes at a time. A scene that fails is left out (the
 * Studio offers to redraw it) so one bad drawing doesn't lose the rest.
 */
handlers["storyboard/render"] = async (job, reel, { progress }) => {
  const input = job.input;
  const only = new Set(list(input.only));
  const scenes = list(input.scenes).filter((scene) => !only.size || only.has(scene.n));
  if (!scenes.length) throw stepError("nothing_to_sketch", "There are no scenes to sketch.");
  const times = list(input.script).map((line) => line.time);
  let done = 0;
  const failed = [];
  await progress(`Drawing sketches (0 of ${scenes.length}, usually 1–3 minutes)`);
  const drawn = await inBatches(scenes, SKETCH_AT_ONCE, async (scene) => {
    try {
      const text = await askClaude([SKETCH_RULES, "",
        `The look (JSON): ${JSON.stringify(input.look)}`,
        `Scene ${scene.n} of ${list(input.scenes).length}${times[scene.n - 1] ? `, starting at ${times[scene.n - 1]}` : ""} (JSON): ${JSON.stringify(scene)}`,
      ].join("\n"), { timeoutMs: SKETCH_TIMEOUT_MS, effort: "low" });
      return { n: scene.n, svg: parseSketch(text) };
    } catch (error) {
      failed.push({ n: scene.n, reason: `${error.code ?? "error"}: ${String(error.message).slice(0, 160)}` });
      console.log(`sketch for scene ${scene.n} failed: ${error.code ?? "error"} ${String(error.message).slice(0, 160)}`);
      return null;
    } finally {
      done += 1;
      await progress(`Drawing sketches (${done} of ${scenes.length})`).catch(() => undefined);
    }
  });
  const sketches = drawn.filter(Boolean);
  if (!sketches.length) throw stepError(failed[0]?.reason.split(":")[0] || "claude_bad_output", `None of the sketches could be drawn (${failed[0]?.reason ?? "no answer"}). Try again.`);
  const missed = scenes.length - sketches.length;
  return { status: "needs_review", result: { phase: "sketches", version: input.version, sketches, failed },
    progress: missed ? `Sketches ready (${missed} couldn't be drawn)` : "Sketches ready" };
};

/** Time for the Studio Mac to look at one uploaded image. */
export const IMAGE_CHECK_TIMEOUT_MS = 3 * 60_000;

export function parseImageCheck(text) {
  const data = jsonIn(text, "{", "an image check");
  const verdict = data.verdict === "good" ? "good" : data.verdict === "redo" ? "redo" : null;
  if (!verdict) throw stepError("claude_bad_output", "Claude did not say whether the image is good.");
  return { verdict, notes: str(data.notes, 500) };
}

/**
 * Images, check: downloads the creator's upload (a link made when the job was claimed), shrinks a copy for reading,
 * and has Claude compare it with what the storyboard asked for. It can't compare faces with the cast's character
 * sheets yet; those aren't in Studio.
 */
handlers["images/draft"] = async (job, reel, { progress }) => {
  const input = job.input;
  if (input.phase !== "review" || typeof input.imageUrl !== "string") throw stepError("image_link_missing", "There is no image to check.");
  const dir = mkdtempSync(join(tmpdir(), "tiny-soho-image-"));
  try {
    await progress(`Looking at ${str(input.file, 80)}`);
    const response = await fetch(input.imageUrl);
    if (!response.ok) throw stepError("image_download_failed", "The image couldn't be downloaded. Try the check again.");
    const ext = input.mime === "image/jpeg" ? "jpg" : input.mime === "image/webp" ? "webp" : "png";
    writeFileSync(join(dir, `upload.${ext}`), Buffer.from(await response.arrayBuffer()));
    // A smaller PNG copy keeps transparency and reads faster.
    await run("sips", ["-s", "format", "png", "-Z", "1600", `upload.${ext}`, "--out", "check.png"], { cwd: dir, code: "image_unreadable" });
    const image = input.image ?? {};
    const text = await askClaude([
      "You check images for @tinysoho story reels before they are animated. Look at check.png in this folder.",
      `It should be: ${str(image.purpose, 200)}.`,
      `The prompt it was made from: ${str(image.prompt, 1200)}`,
      `Background: ${image.background === "transparent" ? "transparent (a cut-out)" : "a full background"}. Aspect asked: ${str(image.aspect, 12)}.`,
      image.reference && image.reference !== "none" ? `It shows ${image.reference === "anaika" ? "Anaika, the toddler" : "her mum"} (AI-generated cast).` : "",
      input.look ? `The reel's look: ${str(input.look.name, 80)}: ${str(input.look.treatment, 400)}` : "",
      `Instant checks already run: ${list(input.checks).map((check) => `${check.level}: ${check.message}`).join("; ") || "none"}.`,
      "",
      "Say it is good if it shows what was asked and would work in the reel. Say redo for any of: the wrong subject or pose;",
      "a child in distress (crying, wailing, hurt); text, logos or watermarks baked into the picture; extra or broken",
      "fingers, limbs or faces; a background where a cut-out was asked for; colours far from the brand (cocoa, cream,",
      "rose, sage, gold, night blue, pumpkin in illustrations); a style that clashes with the look.",
      'Answer with only JSON: {"verdict": "good" | "redo", "notes": string}. notes: one or two short sentences; for redo, say',
      "exactly what to change in the prompt or the image.",
    ].filter(Boolean).join("\n"), { cwd: dir, tools: ["Read"], maxTurns: 4, timeoutMs: IMAGE_CHECK_TIMEOUT_MS });
    const check = parseImageCheck(text);
    return { status: "needs_review", result: { phase: "review", file: input.file, uploadId: input.uploadId, ...check },
      progress: check.verdict === "good" ? "Looks good" : "Needs a redo" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

handlers["voice/draft"] = (job, reel, tools) => voiceJob(job, reel, tools, { askClaude, run, transcribe });
handlers["voice/revise"] = handlers["voice/draft"];

export async function handle(job, reel, tools) {
  const handler = handlers[`${job.step}/${job.kind}`];
  if (!handler) throw stepError("step_not_ready", `The ${job.step} step (${job.kind}) isn't built into the runner yet.`);
  return handler(job, reel, tools);
}
