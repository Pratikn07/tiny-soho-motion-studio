// The Build step: Claude Code writes a Studio reel's scenes in the motion engine, then the Mac checks every scene
// renders, makes a quick preview with the voice, and commits the reel. It works in Studio's own copy of the engine
// (a git worktree on branch `studio`, default ~/Documents/working/mch/tiny-soho-reels-studio), and only ever writes
// that reel's files: timelines/rNN.ts, scenes/rNN_*.ts, data/reelNN, audio/reelNN, public/hf/reelNN.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BUILD_TIMEOUT_MS = 45 * 60_000;
const RENDER_TIMEOUT_MS = 20 * 60_000;
/** An address nothing listens on, so render.ts always starts its own private, no-reload server in Studio's copy. */
const PRIVATE = "http://127.0.0.1:9";

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

export const engineDir = (env = {}) => env.engineDir || join(homedir(), "Documents", "working", "mch", "tiny-soho-reels-studio");
export const reelId = (n) => String(n).padStart(2, "0");
const round = (value) => Math.round(value * 1000) / 1000;

/** The paths a Studio reel may write, relative to the engine root. */
export function allowedPaths(nn) {
  return [`app/src/timelines/r${nn}.ts`, `app/src/scenes/r${nn}_`, `data/reel${nn}/`, `audio/reel${nn}/`, `app/public/hf/reel${nn}/`];
}

/** Changed files (from `git status --porcelain`) that this reel is not allowed to touch. */
export function outsideChanges(porcelain, nn) {
  const allowed = allowedPaths(nn);
  return porcelain.split("\n").filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop())
    .filter((path) => !allowed.some((prefix) => path === prefix || path.startsWith(prefix)));
}

/**
 * The engine's word-timing file from a Studio voice take: one line per script line (spoken words only, no cues),
 * each word with its time. Scenes look lines and words up by this text.
 */
export function lyricsFromTake(take) {
  const lines = (take.lines ?? []).map((line) => {
    const words = (take.words ?? []).filter((word) => word.n === line.n).map((word) => ({ w: word.word, start: round(word.start), end: round(word.end) }));
    const text = String(line.text ?? "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    return { text, start: round(words[0]?.start ?? line.start), end: round(words.at(-1)?.end ?? line.end), words };
  });
  return { source: "Tiny Soho Studio voice take (ElevenLabs character timings)", lines };
}

/** Where each scene starts and ends: each cut sits just before its line's first word, the last scene runs to the end. */
export function sceneSpans(lyrics, seconds, count) {
  const starts = lyrics.lines.slice(0, count).map((line, index) => {
    if (index === 0) return 0;
    const gap = line.start - lyrics.lines[index - 1].end;
    return round(line.start - Math.min(0.18, Math.max(0.04, gap * 0.45)));
  });
  return starts.map((start, index) => ({ n: index + 1, start, end: round(index < starts.length - 1 ? starts[index + 1] : seconds) }));
}

/** Runs a command, streaming nothing; resolves with stdout and stderr, rejects with `code` on failure. */
function sh(command, args, { cwd, env, timeoutMs = 120_000, code = "build_tool_failed" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(stepError(code, `${command} took too long.`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(stepError(code, `${command}: ${error.message}`)); });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status !== 0) return reject(Object.assign(stepError(code, `${command} failed: ${(err || out).trim().slice(-300)}`), { stdout: out, stderr: err }));
      resolve({ stdout: out, stderr: err });
    });
  });
}

/** Scene errors the engine reported while rendering (render.ts prints them after "SCENE ERRORS:"). */
export function sceneErrors(stderr) {
  const at = String(stderr).indexOf("SCENE ERRORS:");
  return at < 0 ? [] : String(stderr).slice(at + 13).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20);
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw stepError("build_download_failed", `Couldn't download ${path.split("/").pop()} (${response.status}).`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

function buildPrompt({ nn, input, spans, lyrics, images, revising }) {
  const scenes = (input.scenes ?? []).map((scene) => {
    const span = spans.find((item) => item.n === scene.n);
    return `Scene ${scene.n} (${span ? `${span.start}-${span.end} s` : "time from its line"}): line "${lyrics.lines[scene.n - 1]?.text ?? ""}"\n`
      + `  paper: ${scene.paper}\n  code draws: ${scene.codeDraws}\n  move: ${scene.move}\n  into next: ${scene.transition}\n`
      + `  images: ${(scene.images ?? []).map((image) => `${image.file}${image.reuse ? ` (reuse: ${image.reuse})` : ""}`).join(", ") || "none"}`;
  }).join("\n");
  return [
    `You are building Tiny Soho reel ${nn} ("${input.title ?? ""}") in this motion engine: a 9:16, ${spans.at(-1)?.end ?? ""} s story reel.`,
    "Read these first: STYLE.md (the film language), app/src/scenes/hook.ts and app/src/scenes/myth.ts (how a scene is written),",
    "app/src/scenes/_brand.ts and app/src/scenes/_vo.ts (shared drawing helpers: use them, never edit them), app/src/timeline.ts",
    "(how a timeline is built; the ReelTimeline type) and app/src/timelines/README.md.",
    "",
    "Files you may create or change, and nothing else:",
    `- app/src/timelines/r${nn}.ts: default-export a ReelTimeline returning one entry per scene, e.g.`,
    `  { id: 'r${nn}_hook', load: scene('r${nn}_hook'), start, end }, with the times below.`,
    `- app/src/scenes/r${nn}_<name>.ts: one file per scene (a class extending Scene), plus at most one shared r${nn}_kit.ts.`,
    `Never edit _brand.ts, _vo.ts, engine/, scripts/, timeline.ts, or any other reel's files. Never run git.`,
    "",
    `Word timings are in data/reel${nn}/lyrics.json and the voice in audio/reel${nn}/voiceover.mp3 (the engine loads both with ?reel=${nn}).`,
    "Look lines up with ly.get(<exact text from lyrics.json>) and words with wordOf(line, <word>); a text that isn't there throws.",
    `Images are in app/public/hf/reel${nn}/ (load with loadImage('hf/reel${nn}/<file>')): ${images.join(", ") || "none"}.`,
    "Images marked 'reuse' that name a reel 01 asset live in app/public/hf/ already (for example hf/paper-kraft.png); check before using.",
    "",
    `The look (keep every scene inside it): ${JSON.stringify(input.look ?? {})}`,
    "Rules: one idea and one signature move per scene, landing on its spoken word; scenes change through an object, not a plain",
    "cut; calm editorial motion only: rises, slides, fades, stamps, slow push-ins. No hop, bounce, wiggle, jiggle or overshoot",
    "on words or stickers, not even a small one (Tiny Soho is premium, never kiddish); the rose italic emphasis word; text inside the safe area; frame 0 is",
    "the cover (hook line readable); everything a pure function of time; end on the Tiny Soho lockup (lockup() in _brand.ts).",
    "",
    "Scenes:", scenes,
    "",
    revising
      ? `The creator asks: ${String(input.comments ?? "").slice(0, 1000)}${input.scene ? ` (scene ${input.scene} only: change only that scene's file, and the timeline only if its times must change)` : ""}. Keep everything else as it is.`
      : "Write the timeline and every scene.",
    "",
    "Check your work: render stills at each scene's middle, then look at them with Read and fix anything off or broken:",
    `  bun app/scripts/render.ts stills --reel ${nn} --url ${PRIVATE} --t ${spans.map((span) => round((span.start + span.end) / 2)).join(",")} --out out/reel${nn}/check`,
    "A line starting 'SCENE ERRORS:' in its output means a scene threw: fix it and render again. Stop when every scene renders cleanly",
    "and looks right. Finish with two or three plain sentences (under 500 characters) on what you built and anything the creator",
    "should look at.",
  ].join("\n");
}

/**
 * Build (draft): set up the reel's files, have Claude Code write the scenes, check and render a preview, commit.
 * Build (revise): the same with the creator's comment, changing one scene or the whole reel.
 */
export async function buildJob(job, reel, tools, deps) {
  // Keep the Mac awake for the whole build (Claude Code plus renders can take most of an hour).
  const awake = spawn("caffeinate", ["-i", "-t", String(Math.ceil((BUILD_TIMEOUT_MS + 2 * RENDER_TIMEOUT_MS) / 1000))], { stdio: "ignore" });
  awake.on("error", () => undefined);
  try {
    return await build(job, tools, deps);
  } finally {
    awake.kill();
  }
}

async function build(job, tools, deps) {
  const input = job.input;
  const nn = reelId(input.reelNo);
  if (!/^\d{2,3}$/.test(nn) || Number(nn) < 3) throw stepError("build_bad_reel", "Studio reels are numbered from 03.");
  const root = engineDir(tools.env);
  if (!existsSync(join(root, "app", "scripts", "render.ts"))) throw stepError("engine_missing", `Studio's engine copy isn't at ${root}.`);
  const revising = job.kind === "revise";
  const take = input.take;
  if (!take?.lines?.length) throw stepError("no_voice", "There is no approved voice take to build to.");

  // Only this reel's files may be dirty when a build starts; anything else means someone edited Studio's copy.
  const before = (await sh("git", ["status", "--porcelain"], { cwd: root })).stdout;
  const foreign = outsideChanges(before, nn);
  if (foreign.length) throw stepError("engine_dirty", `Studio's engine copy has other changes (${foreign.slice(0, 3).join(", ")}). Commit or remove them first.`);

  await tools.progress("Setting up the reel's files");
  const dirs = { data: join(root, "data", `reel${nn}`), audio: join(root, "audio", `reel${nn}`), hf: join(root, "app", "public", "hf", `reel${nn}`), out: join(root, "out", `reel${nn}`) };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const files = input.files ?? {};
  if (!files["voiceover.mp3"]) throw stepError("build_link_missing", "The voice take's link is missing. Try again.");
  await download(files["voiceover.mp3"], join(dirs.audio, "voiceover.mp3"));
  const images = [];
  for (const [name, url] of Object.entries(files)) {
    if (name === "voiceover.mp3") continue;
    await download(url, join(dirs.hf, name));
    images.push(name);
  }
  const lyrics = lyricsFromTake(take);
  writeFileSync(join(dirs.data, "lyrics.json"), `${JSON.stringify(lyrics, null, 1)}\n`);
  await sh("uv", ["run", "--quiet", "--no-project", "--with", "numpy", "python", "analysis/audio_vo.py"], { cwd: root, env: { REEL: nn }, timeoutMs: 180_000, code: "build_audio_failed" });
  const audio = JSON.parse(readFileSync(join(dirs.data, "audio.json"), "utf8"));
  const seconds = round(Number(audio.duration) || take.seconds);
  const spans = sceneSpans(lyrics, seconds, (input.scenes ?? []).length || lyrics.lines.length);

  await tools.progress(revising ? `Claude Code is changing ${input.scene ? `scene ${input.scene}` : "the reel"} (usually 5–15 minutes)` : "Claude Code is writing the scenes (usually 10–30 minutes)");
  const summary = await deps.askClaude(buildPrompt({ nn, input, spans, lyrics, images, revising }), {
    cwd: root, timeoutMs: BUILD_TIMEOUT_MS, maxTurns: 120,
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
    allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash(bun app/scripts/render.ts:*)", "Bash(ls:*)"],
  });

  // Anything Claude changed outside this reel's files is put back.
  const after = (await sh("git", ["status", "--porcelain"], { cwd: root })).stdout;
  const strays = outsideChanges(after, nn);
  for (const path of strays) await sh("git", ["checkout", "--", path], { cwd: root }).catch(() => rmSync(join(root, path), { recursive: true, force: true }));
  if (!existsSync(join(root, "app", "src", "timelines", `r${nn}.ts`))) throw stepError("build_incomplete", "Claude Code didn't write the reel's timeline. Try again.");

  await tools.progress("Checking every scene renders");
  rmSync(join(dirs.out, "stills"), { recursive: true, force: true });
  const mids = spans.map((span) => round((span.start + span.end) / 2));
  const stillRun = await sh("bun", ["scripts/render.ts", "stills", "--reel", nn, "--url", PRIVATE, "--t", mids.join(","), "--out", join(dirs.out, "stills")],
    { cwd: join(root, "app"), timeoutMs: RENDER_TIMEOUT_MS, code: "build_render_failed" });
  const errors = sceneErrors(stillRun.stderr);
  if (errors.length) throw stepError("build_scene_errors", `Some scenes don't render: ${errors.slice(0, 2).join(" · ").slice(0, 160)}`);

  await tools.progress("Rendering the preview (usually 3–6 minutes)");
  const full = join(dirs.out, `preview-${Date.now()}.mp4`);
  await sh("bun", ["scripts/render.ts", "video", "--reel", nn, "--url", PRIVATE, "--fps", "30", "--samples", "1", "--crf", "22", "--preset", "veryfast", "--out", full],
    { cwd: join(root, "app"), timeoutMs: RENDER_TIMEOUT_MS, code: "build_render_failed" });
  const small = join(dirs.out, "preview-web.mp4");
  await sh("ffmpeg", ["-v", "error", "-y", "-i", full, "-vf", "scale=540:960", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", small],
    { timeoutMs: 300_000, code: "build_render_failed" });

  await tools.progress("Uploading the preview and stills");
  const version = Number(input.version) || 1;
  const preview = await tools.upload(`r${nn}-v${version}-preview.mp4`, "video/mp4", readFileSync(small));
  const stills = [];
  const pngs = readdirSync(join(dirs.out, "stills")).filter((name) => name.endsWith(".png")).sort();
  for (const [index, png] of pngs.entries()) {
    const jpg = join(dirs.out, "stills", png.replace(/\.png$/, ".jpg"));
    await sh("sips", ["-s", "format", "jpeg", "-Z", "960", join(dirs.out, "stills", png), "--out", jpg], { code: "build_render_failed" });
    stills.push({ n: spans[index]?.n ?? index + 1, t: mids[index], objectPath: await tools.upload(`r${nn}-v${version}-scene-${index + 1}.jpg`, "image/jpeg", readFileSync(jpg)) });
  }

  await tools.progress("Saving the build");
  await sh("git", ["add", "-A", "--", `app/src/timelines/r${nn}.ts`, "app/src/scenes", `data/reel${nn}`, `audio/reel${nn}`, `app/public/hf/reel${nn}`], { cwd: root });
  const staged = (await sh("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout.split("\n").filter(Boolean);
  const notOurs = staged.filter((path) => outsideChanges(` M ${path}`, nn).length);
  if (notOurs.length) await sh("git", ["reset", "-q", "--", ...notOurs], { cwd: root });
  let commit = null;
  if (staged.length > notOurs.length) {
    await sh("git", ["commit", "-q", "-m", `Studio reel ${nn}: ${String(input.title ?? "").slice(0, 60)} (build v${version})`], { cwd: root });
    commit = (await sh("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim();
  }
  return {
    status: "needs_review",
    result: { phase: "build", reelNo: Number(nn), version, seconds, preview, stills, commit, notes: String(summary ?? "").trim().slice(0, 800) },
    progress: "Preview ready",
  };
}
