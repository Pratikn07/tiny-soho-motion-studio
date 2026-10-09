// The Export step: the final 1080x1920, 30 fps render with motion blur (reel 01's settings), the approved sound mix
// added, the cover (the opening frame, where the hook is readable) and a caption, all uploaded for download.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { engineDir, reelId } from "./build.mjs";

export const EXPORT_TIMEOUT_MS = 60 * 60_000;
const PRIVATE = "http://127.0.0.1:9";

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Reads Claude's caption: the text, kept to Instagram's limits. */
export function parseCaption(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  let data = null;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { /* falls through */ }
  const caption = String(data?.caption ?? text).trim().slice(0, 2200);
  if (!caption) throw stepError("claude_bad_output", "Claude did not return a caption.");
  const hashtags = (Array.isArray(data?.hashtags) ? data.hashtags : []).map((tag) => `#${String(tag).replace(/^#/, "").replace(/\s+/g, "")}`).slice(0, 5);
  return { caption, hashtags };
}

export async function exportJob(job, reel, tools, deps) {
  const input = job.input;
  const nn = reelId(input.reelNo);
  const root = engineDir(tools.env);
  const out = join(root, "out", `reel${nn}`);
  if (!existsSync(join(out, "mix.wav"))) throw stepError("no_sound", "Approve the sound before exporting.");
  const awake = spawn("caffeinate", ["-i", "-t", String(Math.ceil(EXPORT_TIMEOUT_MS / 1000))], { stdio: "ignore" });
  awake.on("error", () => undefined);
  try {
    await tools.progress("Rendering the final video with motion blur (usually 10–25 minutes)");
    const picture = join(out, "final-picture.mp4");
    await deps.run("bun", ["scripts/render.ts", "video", "--reel", nn, "--url", PRIVATE, "--fps", "30", "--samples", "auto", "--min-samples", "4",
      "--max-samples", "12", "--shutter", "0.5", "--crf", "17", "--preset", "slow", "--noaudio", "--out", picture],
    { cwd: join(root, "app"), timeoutMs: EXPORT_TIMEOUT_MS, code: "export_render_failed" });

    await tools.progress("Adding the sound");
    const final = join(out, "final.mp4");
    await deps.run("ffmpeg", ["-v", "error", "-y", "-i", picture, "-i", join(out, "mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", final], { timeoutMs: 300_000, code: "export_render_failed" });

    await tools.progress("Making the cover");
    const cover = join(out, "cover.jpg");
    await deps.run("ffmpeg", ["-v", "error", "-y", "-ss", String(Number(input.coverAt ?? 0.1)), "-i", final, "-frames:v", "1", "-q:v", "2", cover],
      { timeoutMs: 60_000, code: "export_render_failed" });

    await tools.progress("Writing the caption");
    const brief = input.brief ?? {};
    const text = await deps.askClaude([
      "Write the Instagram caption for a @tinysoho story reel: a calm, realistic parenting account for US moms of toddlers.",
      "Warm, plain US English, no shaming, no medical advice, 'probably' for anything uncertain. The first line repeats the hook's",
      "claim. Then 1-3 short lines, 'More at mycuratedhaven.com · link in bio', the save prompt, and last a question a parent",
      "can answer in one word (use the caption question if given). 3-5 relevant hashtags, no banned or spammy ones.",
      `Title: ${brief.title ?? input.title ?? ""}. Hook: ${brief.hook ?? ""}. Takeaway: ${brief.takeaway ?? ""}. Save prompt: ${brief.savePrompt ?? ""}.`,
      `Caption question: ${brief.captionQuestion ?? ""}.`,
      `Facts and sources: ${JSON.stringify(brief.facts ?? [])}. If a study is named in the reel, credit it briefly.`,
      `Script: ${(input.lines ?? []).join(" ").replace(/\[[^\]]*\]/g, "").slice(0, 1500)}`,
      'Answer with only JSON: {"caption": string (without the hashtags), "hashtags": [string]}.',
    ].join("\n"), { timeoutMs: 120_000, effort: "low" });
    const { caption, hashtags } = parseCaption(text);

    await tools.progress("Uploading the final video");
    const version = Number(input.version) || 1;
    const finalPath = await tools.upload(`r${nn}-final-v${version}.mp4`, "video/mp4", readFileSync(final));
    const coverPath = await tools.upload(`r${nn}-cover-v${version}.jpg`, "image/jpeg", readFileSync(cover));
    const probe = await deps.run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]);
    return {
      status: "needs_review",
      result: {
        phase: "export", reelNo: Number(nn), version, final: finalPath, cover: coverPath, caption, hashtags,
        seconds: Math.round((Number.parseFloat(probe.stdout) || 0) * 10) / 10, bytes: statSync(final).size, width: 1080, height: 1920, fps: 30,
      },
      progress: "Final video ready",
    };
  } finally {
    awake.kill();
  }
}
