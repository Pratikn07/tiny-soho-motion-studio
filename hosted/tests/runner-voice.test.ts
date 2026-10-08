import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { voiceTakeSchema } from "@/lib/reels";

// The runner is plain Node (runner/voice.mjs); its takes must be what the Studio accepts.
const voice: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/voice.mjs", import.meta.url).href);
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

afterEach(() => vi.unstubAllGlobals());

describe("voice helpers", () => {
  it("keeps cues out of what's heard, and finds cue words", () => {
    expect(voice.spokenText("[curious] That Halloween meltdown? [pause] It's probably NOT the sugar.")).toBe("That Halloween meltdown? It's probably NOT the sugar.");
    expect(voice.cueWords(["[curious] A", "[matter-of-fact] B [curious]"])).toEqual(["curious", "matter of fact"]);
  });

  it("flags a take that reads a cue aloud", () => {
    const lines = ["[curious] So what is it?", "[warmly] Protect the bedtime."];
    expect(voice.cueCheck("Curious. So what is it? Protect the bedtime.", lines)).toMatchObject({ ok: false, spokenCues: ["curious"] });
    expect(voice.cueCheck("So what is it? Protect the bedtime.", lines)).toMatchObject({ ok: true, spokenCues: [], heard: 1 });
    expect(voice.cueCheck("", lines)).toMatchObject({ ok: true, heard: null });
  });

  it("times words from ElevenLabs' characters, skipping cues, shifted to the line's start", () => {
    const text = "[curious] So what?";
    const chars = [...text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1) };
    expect(voice.wordsFromAlignment(alignment, 2, 3)).toEqual([
      { n: 3, word: "So", start: 3, end: 3.2 }, { n: 3, word: "what?", start: 3.3, end: 3.8 },
    ]);
  });

  it("plans line positions with gaps between, not after the last", () => {
    expect(voice.joinPlan([2, 1.5, 3], 0.3)).toEqual([{ start: 0, end: 2 }, { start: 2.3, end: 3.8 }, { start: 4.1, end: 7.1 }]);
  });

  it("says how to set up ElevenLabs when the key is missing", async () => {
    await expect(voice.voiceJob({ input: { lines: ["Hi"] } }, null, { progress: async () => {}, env: {} }, {}))
      .rejects.toMatchObject({ code: "elevenlabs_not_set_up" });
  });
});

describe.skipIf(!hasFfmpeg)("voice job end to end (ElevenLabs stood in)", () => {
  it("records both takes line by line, joins them and returns takes the Studio accepts", { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-test-"));
    const tone = join(dir, "tone.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-ac", "1", "-b:a", "64k", tone]);
    const audio = readFileSync(tone).toString("base64");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes("/user/subscription")) return new Response(JSON.stringify({ character_count: 1600, character_limit: 40000 }));
      const text = JSON.parse(String(init?.body)).text as string;
      const chars = [...text];
      return new Response(JSON.stringify({ audio_base64: audio, alignment: { characters: chars,
        character_start_times_seconds: chars.map((_, i) => (i / chars.length) * 1.1), character_end_times_seconds: chars.map((_, i) => ((i + 1) / chars.length) * 1.1) } }));
    }));
    const reelId = `test-${Date.now()}`;
    const uploads: string[] = [];
    const run = (command: string, args: string[], options: { cwd?: string } = {}) => Promise.resolve({ stdout: execFileSync(command, args, { cwd: options.cwd }).toString(), stderr: "" });
    try {
      const outcome = await voice.voiceJob(
        { reelId, input: { phase: "takes", lines: ["[curious] Four bites?", "[warmly] That might be dinner."] } }, null,
        { progress: async () => {}, env: { key: "k", voiceId: "v" }, upload: async (name: string) => { uploads.push(name); return `owners/o/reels/r/voice/${name}`; } },
        { run, transcribe: async () => "Four bites? That might be dinner.", askClaude: async () => "" },
      );
      expect(uploads).toEqual(["take-a.mp3", "take-b.mp3"]);
      expect(calls.filter((url) => url.includes("/with-timestamps"))).toHaveLength(4);
      const [natural, tight] = outcome.result.takes;
      expect(natural.lines[1].start).toBeCloseTo(natural.lines[0].end + 0.3, 1);
      expect(tight.lines[1].start).toBeCloseTo(tight.lines[0].end + 0.2, 1);
      expect(natural.seconds).toBeGreaterThan(2.5);
      expect(natural.words.map((word: { word: string }) => word.word)).toEqual(["Four", "bites?", "That", "might", "be", "dinner."]);
      for (const take of outcome.result.takes) expect(voiceTakeSchema.safeParse(take).success).toBe(true);
      expect(outcome.result.credits).toMatchObject({ remaining: 38400, limit: 40000 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(join(homedir(), ".cache", "tiny-soho", "voice", reelId), { recursive: true, force: true });
    }
  });
});
