// The Voice step: two takes of the approved script in the owner's cloned ElevenLabs voice, made line by line on this
// Mac, joined with ffmpeg, word-timed from ElevenLabs' own character timings, and checked for voice cues read aloud.
// Line recordings stay in ~/.cache/tiny-soho/voice so redoing one line re-voices only that line.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.elevenlabs.io/v1";
export const VOICE_MODEL = "eleven_v4";
export const DEFAULT_TAKES = [
  { id: "a", label: "Natural", gap: 0.3, stability: 0.45 },
  { id: "b", label: "Tight", gap: 0.2, stability: 0.4 },
];

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** The words a listener hears: voice cues in square brackets removed, spaces tidied. */
export const spokenText = (line) => String(line ?? "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

/** The cue words in a script ("curious", "matter of fact"…), to catch a take that reads one aloud. */
export function cueWords(lines) {
  const cues = new Set();
  for (const line of lines) for (const match of String(line).matchAll(/\[([^\]]+)\]/g)) cues.add(match[1].toLowerCase().replace(/[-_]/g, " ").trim());
  return [...cues].filter(Boolean);
}

const normal = (text) => ` ${String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;

/**
 * Flags cue words heard in the transcript that the script doesn't say out loud, and reports how much of the script
 * was heard. A take with spoken cues should be redone.
 */
export function cueCheck(transcript, lines) {
  if (!transcript) return { ok: true, spokenCues: [], heard: null, transcript: "" };
  const heardText = normal(transcript);
  const scriptText = normal(lines.map(spokenText).join(" "));
  const spokenCues = cueWords(lines).filter((cue) => heardText.includes(` ${cue} `) && !scriptText.includes(` ${cue} `));
  const scriptWords = scriptText.trim().split(" ").filter(Boolean);
  const heardWords = new Set(heardText.trim().split(" "));
  const heard = scriptWords.length ? Math.round((scriptWords.filter((word) => heardWords.has(word)).length / scriptWords.length) * 100) / 100 : null;
  return { ok: spokenCues.length === 0, spokenCues, heard, transcript: transcript.slice(0, 2000) };
}

/**
 * Word timings from ElevenLabs' character alignment, skipping anything inside square brackets (voice cues), shifted
 * by where the line starts in the take.
 */
export function wordsFromAlignment(alignment, offset, n) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words = [];
  let depth = 0, word = "", start = null, end = null;
  const flush = () => {
    const clean = word.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9'.,!?…]+$/g, "");
    if (clean && /[A-Za-z0-9]/.test(clean) && start !== null) words.push({ n, word: clean, start: round(start + offset), end: round(end + offset) });
    word = ""; start = null; end = null;
  };
  chars.forEach((char, index) => {
    if (char === "[") { flush(); depth += 1; return; }
    if (char === "]") { depth = Math.max(0, depth - 1); return; }
    if (depth) return;
    if (/\s/.test(char)) { flush(); return; }
    if (start === null) start = starts[index] ?? 0;
    end = ends[index] ?? start;
    word += char;
  });
  flush();
  return words;
}

const round = (value) => Math.round(value * 1000) / 1000;

/** Where each line starts and ends when the lines are joined with `gap` seconds between them. */
export function joinPlan(durations, gap) {
  let at = 0;
  return durations.map((duration, index) => {
    const line = { start: round(at), end: round(at + duration) };
    at += duration + (index < durations.length - 1 ? gap : 0);
    return line;
  });
}

async function eleven(path, { key, body }) {
  const response = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw stepError("elevenlabs_key_rejected", "ElevenLabs rejected the API key in runner.env.");
  if (response.status === 402 || response.status === 429) throw stepError("elevenlabs_quota", "ElevenLabs is out of credits or busy. Try again later.");
  if (!response.ok) throw stepError("elevenlabs_failed", `ElevenLabs answered ${response.status}.`);
  return response.json();
}

/** Voices one line; returns the mp3 bytes and ElevenLabs' character timings. */
async function voiceLine(env, text, { stability, previous, next }) {
  const data = await eleven(`/text-to-speech/${env.voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    key: env.key,
    body: {
      text, model_id: VOICE_MODEL, previous_text: previous || undefined, next_text: next || undefined,
      voice_settings: { stability, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    },
  });
  if (!data?.audio_base64) throw stepError("elevenlabs_failed", "ElevenLabs returned no audio.");
  return { audio: Buffer.from(data.audio_base64, "base64"), alignment: data.alignment ?? data.normalized_alignment ?? null };
}

const cacheDir = (reelId, takeId) => {
  const dir = join(homedir(), ".cache", "tiny-soho", "voice", String(reelId), String(takeId));
  mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Voice, draft: both takes, every line. Voice, line: one line of one take again, with the creator's note turned
 * into new cues by Claude; the other lines come from this Mac's cache (or are voiced again if the cache is gone).
 */
export async function voiceJob(job, reel, tools, deps) {
  const env = tools.env ?? {};
  if (!env.key || !env.voiceId) {
    throw stepError("elevenlabs_not_set_up", "Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to ~/.config/tiny-soho/runner.env, then try again.");
  }
  const input = job.input;
  const lines = (Array.isArray(input.lines) ? input.lines : []).map((line) => String(line.voice ?? line)).filter(Boolean).slice(0, 20);
  if (!lines.length) throw stepError("no_script", "There is no approved script to voice.");
  const reelId = job.reelId ?? reel?.id;
  const takes = input.phase === "line" ? [input.take] : (Array.isArray(input.takes) && input.takes.length ? input.takes : DEFAULT_TAKES);
  const texts = [...lines];
  let characters = 0;

  if (input.phase === "line") {
    const n = Number(input.n);
    if (!Number.isInteger(n) || n < 1 || n > lines.length) throw stepError("no_line", "That line isn't in the script.");
    await tools.progress(`Rewriting the direction for line ${n}`);
    const rewritten = await deps.askClaude([
      "You direct a warm mom narrator voiced with ElevenLabs eleven_v4. Audio tags in square brackets go just before the",
      "words they change: [curious] [pause] [warmly] [softly] [whispers] [slowly] [excited] [mischievously] [matter-of-fact]",
      "[brisk]. CAPITALS stress one word. \"…\" gives a short beat. No <break> tags.",
      `The line: ${lines[n - 1]}`,
      `The creator's note on how it should sound: ${String(input.note ?? "").slice(0, 300)}`,
      "Change only the tags, capitals and punctuation to get that delivery. Keep every spoken word exactly. Answer with only the new line.",
    ].join("\n"), { timeoutMs: 120_000, effort: "low" });
    const candidate = rewritten.trim().split("\n").pop().trim().replace(/^["']|["']$/g, "");
    texts[n - 1] = spokenText(candidate).toLowerCase() === spokenText(lines[n - 1]).toLowerCase() ? candidate : lines[n - 1];
  }

  const made = [];
  for (const [index, take] of takes.entries()) {
    const dir = cacheDir(reelId, take.id);
    const files = [];
    for (let i = 0; i < texts.length; i += 1) {
      const audioPath = join(dir, `line-${i + 1}.mp3`), metaPath = join(dir, `line-${i + 1}.json`);
      const cached = existsSync(audioPath) && existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;
      const redo = input.phase !== "line" || i === Number(input.n) - 1 || !cached || cached.text !== texts[i];
      if (redo) {
        await tools.progress(`Recording take ${index + 1} of ${takes.length}, line ${i + 1} of ${texts.length}`);
        const voiced = await voiceLine(env, texts[i], { stability: take.stability ?? 0.45, previous: spokenText(texts[i - 1]), next: spokenText(texts[i + 1]) });
        writeFileSync(audioPath, voiced.audio);
        writeFileSync(metaPath, JSON.stringify({ text: texts[i], alignment: voiced.alignment }));
        characters += texts[i].length;
      }
      files.push({ audioPath, meta: JSON.parse(readFileSync(metaPath, "utf8")) });
    }

    await tools.progress(`Joining take ${index + 1} of ${takes.length}`);
    const durations = [];
    for (const file of files) {
      const { stdout } = await deps.run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file.audioPath]);
      durations.push(Number.parseFloat(stdout) || 0);
    }
    const plan = joinPlan(durations, take.gap);
    const out = join(dir, `take-${Date.now()}.mp3`);
    const filters = files.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono${i < files.length - 1 ? `,apad=pad_dur=${take.gap}` : ""}[a${i}]`);
    await deps.run("ffmpeg", ["-v", "error", "-y", ...files.flatMap((file) => ["-i", file.audioPath]),
      "-filter_complex", `${filters.join(";")};${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`,
      "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", out], { timeoutMs: 120_000, code: "voice_join_failed" });
    const { stdout: total } = await deps.run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);

    await tools.progress(`Checking take ${index + 1} of ${takes.length} for cues read aloud`);
    const transcript = await deps.transcribe(dir, out);
    const objectPath = await tools.upload(`take-${take.id}.mp3`, "audio/mpeg", readFileSync(out));
    made.push({
      id: take.id, label: take.label, gap: take.gap, stability: take.stability ?? 0.45, objectPath,
      seconds: round(Number.parseFloat(total) || plan.at(-1)?.end || 0),
      lines: plan.map((span, i) => ({ n: i + 1, text: texts[i], start: span.start, end: span.end })),
      words: files.flatMap((file, i) => wordsFromAlignment(file.meta.alignment, plan[i].start, i + 1)),
      cueCheck: cueCheck(transcript, texts),
    });
  }

  let credits = null;
  try {
    const sub = await eleven("/user/subscription", { key: env.key });
    credits = { used: characters, remaining: Math.max(0, (sub.character_limit ?? 0) - (sub.character_count ?? 0)), limit: sub.character_limit ?? null };
  } catch {
    credits = { used: characters, remaining: null, limit: null };
  }
  const flagged = made.filter((take) => !take.cueCheck.ok).length;
  return {
    status: "needs_review",
    result: { phase: input.phase === "line" ? "line" : "takes", takes: made, credits, voiceId: env.voiceId, model: VOICE_MODEL },
    progress: flagged ? `${made.length === 1 ? "Take" : "Takes"} ready (${flagged} read a cue aloud)` : made.length === 1 ? "Line redone" : "Two takes ready",
  };
}
