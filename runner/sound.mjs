// The Sound step: a new music bed from ElevenLabs Music for each reel, one fresh sound effect per on-screen action
// (generated with ElevenLabs and added to the shared sound library, never reused from the last 3 reels), mixed under
// the voice to -14 LUFS with analysis/mix_studio.py in Studio's engine copy, and muxed onto the build preview.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { engineDir, reelId } from "./build.mjs";

const API = "https://api.elevenlabs.io/v1";
export const SOUND_TIMEOUT_MS = 20 * 60_000;
/** The main engine folder's sound library index, read so new effect ids never clash with reel 01/02 work there. */
const MAIN_INDEX = join(process.env.HOME ?? "", "Documents", "working", "mch", "tiny-soho-reels", "audio", "library", "index.json");

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Series sound signatures (docs/reels/claude-project/04-series-and-looks.md). */
const SERIES_SOUND = {
  halloween: "plucked strings and celesta, ending on a gentle music-box lullaby",
  sleep: "soft felt piano, slow and warm",
  myths: "a light pizzicato pulse, curious and tidy",
};

/** The music prompt: the look's music, the series' sound, the reel's arc in the scene moves, calm and instrumental. */
export function musicPrompt({ look, series, scenes, seconds }) {
  const signature = SERIES_SOUND[String(series ?? "").trim().toLowerCase()] ?? "";
  const arc = (scenes ?? []).slice(0, 10).map((scene) => `${scene.n}) ${String(scene.move ?? "").slice(0, 80)}`).join("; ");
  return [
    `Instrumental bed for a ${Math.round(seconds)}-second calm, warm story reel for parents of toddlers.`,
    look?.music ? `Sound: ${look.music}.` : "", signature ? `Series signature: ${signature}.` : "",
    "Gentle and editorial, never kiddish, no vocals, no big drops; leaves room for a narrator's voice.",
    arc ? `It follows these moments in order: ${arc}.` : "", "Ends softly on a resolved note.",
  ].filter(Boolean).join(" ").slice(0, 2000);
}

/** Effect ids already used anywhere, so a new one never clashes. */
export function usedIds(...indexes) {
  return new Set(indexes.flatMap((index) => (Array.isArray(index?.sfx) ? index.sfx.map((item) => item.id) : [])));
}

/** A safe, unique id for a new effect: r03_pin, r03_pin_2… */
export function effectId(nn, name, taken) {
  const base = `r${nn}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "fx"}`;
  let id = base, k = 2;
  while (taken.has(id)) id = `${base}_${k++}`;
  taken.add(id);
  return id;
}

/** Reads Claude's cue sheet: one effect per on-screen action, times clamped to the reel. */
export function parseCues(text, seconds) {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw stepError("claude_bad_output", "Claude did not return a cue sheet.");
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { throw stepError("claude_bad_output", "The cue sheet could not be read."); }
  return (Array.isArray(data) ? data : []).slice(0, 14).map((cue) => ({
    t: Math.min(Math.max(0, Number(cue.t) || 0), Math.max(0, seconds - 0.3)),
    name: String(cue.name ?? "fx").slice(0, 30), prompt: String(cue.prompt ?? "").slice(0, 300),
    duration: Math.min(Math.max(Number(cue.duration) || 1, 0.5), 4), gainDb: Math.min(Math.max(Number(cue.gainDb) || -4, -14), 0),
    scene: Number.isInteger(cue.scene) ? cue.scene : null,
  })).filter((cue) => cue.prompt);
}

async function eleven(env, path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST", headers: { "xi-api-key": env.key, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (response.status === 401) throw stepError("elevenlabs_key_rejected", "ElevenLabs rejected the API key in runner.env.");
  if (response.status === 402 || response.status === 429) throw stepError("elevenlabs_quota", "ElevenLabs is out of credits or busy. Try again later.");
  if (!response.ok) throw stepError("elevenlabs_failed", `ElevenLabs answered ${response.status} for ${path}.`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Sound: phase "full" makes music and effects and mixes; "music" makes only new music; "level" only remixes with a
 * new music level (no credits); "cues" re-plans the effects from the creator's comment.
 */
export async function soundJob(job, reel, tools, deps) {
  const env = tools.env ?? {};
  if (!env.key) throw stepError("elevenlabs_not_set_up", "Add ELEVENLABS_API_KEY to ~/.config/tiny-soho/runner.env, then try again.");
  const input = job.input;
  const nn = reelId(input.reelNo);
  const root = engineDir(env);
  const audio = join(root, "audio", `reel${nn}`);
  if (!existsSync(join(audio, "voiceover.mp3"))) throw stepError("no_build", "Build the reel before its sound.");
  const phase = input.phase ?? "full";
  const seconds = Number(input.seconds) || 30;
  const sheetPath = join(audio, "sound.json");
  const previous = existsSync(sheetPath) ? JSON.parse(readFileSync(sheetPath, "utf8")) : null;
  let characters = 0;

  // Music: new for a full pass or when asked; otherwise the reel keeps its current bed.
  mkdirSync(join(audio, "music"), { recursive: true });
  const scorePath = join(audio, "music", "score.mp3");
  let prompt = previous?.music_prompt ?? "";
  if (phase === "full" || phase === "music" || !existsSync(scorePath)) {
    await tools.progress("Composing the music (usually 1–2 minutes)");
    prompt = musicPrompt({ look: input.look, series: input.series, scenes: input.scenes, seconds });
    writeFileSync(scorePath, await eleven(env, "/music?output_format=mp3_44100_128", {
      prompt, music_length_ms: Math.ceil((seconds + 0.5) * 1000), model_id: "music_v1", force_instrumental: true,
    }));
  }

  // Effects: planned by Claude on the word timings, generated new for this reel, recorded in the library index.
  const indexPath = join(root, "audio", "library", "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { about: "", sfx: [] };
  let cues = previous?.cues ?? [];
  if (phase === "full" || phase === "cues" || !cues.length) {
    await tools.progress("Placing a sound on each on-screen action");
    const words = (input.take?.words ?? []).map((word) => `${word.n}:${word.word}@${Number(word.start).toFixed(2)}`).join(" ");
    const scenes = (input.scenes ?? []).map((scene) => `scene ${scene.n}: move "${scene.move}"; into next "${scene.transition}"`).join("\n");
    const text = await deps.askClaude([
      "You place sound effects for a calm, editorial Tiny Soho story reel: one soft, tactile effect per on-screen action",
      "(a stamp, a pin, paper, a pop), landing exactly on the word the move lands on; nothing cartoonish, no whooshes on",
      "every cut, at most one effect per scene plus one for the end card. Paper, wood, felt and soft clicks suit the brand.",
      `The look: ${input.look?.name ?? ""}: ${String(input.look?.treatment ?? "").slice(0, 300)}`,
      `Reel length ${seconds.toFixed(1)} s. Scenes:\n${scenes}`,
      `Words (line:word@start seconds): ${words.slice(0, 6000)}`,
      phase === "cues" ? `The creator asks: ${String(input.comments ?? "").slice(0, 600)}. Current cues: ${JSON.stringify(cues.map(({ t, name, prompt: p, gain_db }) => ({ t, name, prompt: p, gainDb: gain_db })))}` : "",
      'Answer with only a JSON array: [{"scene": number, "t": seconds, "name": "short_name", "prompt": "what the sound is, in plain words',
      '(for ElevenLabs sound effects)", "duration": seconds 0.5-3, "gainDb": -12 to -2}].',
    ].filter(Boolean).join("\n"), { timeoutMs: 180_000, effort: "low" });
    const planned = parseCues(text, seconds);
    const main = existsSync(MAIN_INDEX) ? JSON.parse(readFileSync(MAIN_INDEX, "utf8")) : { sfx: [] };
    const taken = usedIds(index, main);
    const reused = new Map((previous?.cues ?? []).map((cue) => [cue.prompt, cue.file]));
    cues = [];
    for (const [i, cue] of planned.entries()) {
      let file = reused.get(cue.prompt);
      if (!file) {
        await tools.progress(`Making sound ${i + 1} of ${planned.length}`);
        const id = effectId(nn, cue.name, taken);
        file = `audio/library/sfx/${id}.mp3`;
        writeFileSync(join(root, file), await eleven(env, "/sound-generation?output_format=mp3_44100_128", {
          text: cue.prompt, duration_seconds: cue.duration, prompt_influence: 0.5,
        }));
        characters += cue.prompt.length;
        index.sfx.push({ id, file: `sfx/${id}.mp3`, prompt: cue.prompt, tags: [cue.name], reels: [`reel${nn}`], status: "in_use",
          source: `ElevenLabs text_to_sound_effects, ${new Date().toISOString().slice(0, 10)} (Tiny Soho Studio)` });
      }
      cues.push({ scene: cue.scene, t: Number(cue.t.toFixed(3)), name: cue.name, prompt: cue.prompt, file, gain_db: cue.gainDb });
    }
    writeFileSync(indexPath, `${JSON.stringify(index, null, 1)}\n`);
  }

  const musicDb = Math.min(Math.max(Number(input.musicDb ?? previous?.music_db ?? -9), -24), -3);
  writeFileSync(sheetPath, `${JSON.stringify({ music_db: musicDb, music_prompt: prompt, cues }, null, 1)}\n`);
  await tools.progress("Mixing to -14 LUFS");
  const mixed = await deps.run("uv", ["run", "--quiet", "--no-project", "--with", "numpy", "python", "analysis/mix_studio.py"],
    { cwd: root, env: { ...process.env, REEL: nn }, timeoutMs: 300_000, code: "sound_mix_failed" });
  const report = JSON.parse(mixed.stdout.trim().split("\n").pop());

  // The build's preview picture with the new mix, for listening in Studio.
  const out = join(root, "out", `reel${nn}`);
  const preview = join(out, "preview-web.mp4");
  if (!existsSync(preview)) throw stepError("no_build", "The build preview is missing. Rebuild the reel.");
  const withSound = join(out, "preview-sound.mp4");
  await deps.run("ffmpeg", ["-v", "error", "-y", "-i", preview, "-i", join(out, "mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", withSound], { timeoutMs: 120_000, code: "sound_mix_failed" });
  const version = Number(input.version) || 1;
  const previewPath = await tools.upload(`r${nn}-sound-v${version}.mp4`, "video/mp4", readFileSync(withSound));

  // Save the reel's sound files and the library additions in Studio's engine copy.
  await deps.run("git", ["add", "--", `audio/reel${nn}`, "audio/library"], { cwd: root });
  const staged = (await deps.run("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout.split("\n").filter(Boolean);
  let commit = null;
  if (staged.length) {
    await deps.run("git", ["commit", "-q", "-m", `Studio reel ${nn}: sound v${version}`], { cwd: root });
    commit = (await deps.run("git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim();
  }
  return {
    status: "needs_review",
    result: {
      phase: "sound", reelNo: Number(nn), version, preview: previewPath, musicPrompt: prompt, musicDb, lufs: -14, commit,
      cues: cues.map(({ scene, t, name, prompt: p, gain_db }) => ({ scene, t, name, prompt: p, gainDb: gain_db })),
      seconds: Number(report.seconds) || seconds, characters,
    },
    progress: "Sound ready to listen to",
  };
}
