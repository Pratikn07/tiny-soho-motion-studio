import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exportsDir } from "./config";

const executable = () => process.env.FFMPEG_PATH || "ffmpeg";
function run(args: string[]) { return new Promise<void>((resolve, reject) => { const child = spawn(executable(), args, { stdio: ["ignore", "ignore", "pipe"] }); let stderr = ""; child.stderr.on("data", (value) => stderr += value); child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${stderr.slice(-500)}`))); }); }

export async function compositeOverlay(video: string, overlay: string, canvas = "1080:1440") {
  await fs.mkdir(exportsDir(), { recursive: true });
  const output = path.join(exportsDir(), `composite-${randomUUID()}.mp4`);
  await run(["-y", "-i", video, "-loop", "1", "-i", overlay, "-filter_complex", `[0:v]scale=${canvas}:force_original_aspect_ratio=decrease,pad=${canvas}:(ow-iw)/2:(oh-ih)/2:black[base];[1:v]scale=${canvas},format=rgba[overlay];[base][overlay]overlay=0:0:format=auto`, "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-shortest", output]);
  return output;
}

export async function concatenateVideos(videos: string[], canvas = "1080:1440") {
  if (!videos.length) throw new Error("At least one completed video is required.");
  await fs.mkdir(exportsDir(), { recursive: true });
  const list = path.join(exportsDir(), `concat-${randomUUID()}.txt`);
  const output = path.join(exportsDir(), `export-${randomUUID()}.mp4`);
  await fs.writeFile(list, videos.map((video) => `file '${video.replace(/'/g, "'\\''")}'`).join("\n"));
  try { await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${canvas}:force_original_aspect_ratio=decrease,pad=${canvas}:(ow-iw)/2:(oh-ih)/2:black,fps=30`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output]); } finally { await fs.rm(list, { force: true }); }
  return output;
}
