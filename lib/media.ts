import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { exportsDir } from "./config";

const executable = () => process.env.FFMPEG_PATH || "ffmpeg";
function run(args: string[]) { return new Promise<void>((resolve, reject) => { const child = spawn(executable(), args, { stdio: ["ignore", "ignore", "pipe"] }); let stderr = ""; child.stderr.on("data", (value) => stderr += value); child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${stderr.slice(-500)}`))); }); }

export type VideoProbe = { width: number; height: number; duration: number };

export async function probeVideoDimensions(filePath: string): Promise<VideoProbe> {
  const executable = process.env.FFPROBE_PATH || "ffprobe";
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath], { maxBuffer: 64 * 1024, timeout: 30_000, killSignal: "SIGKILL" }, (error, stdout) => error ? reject(new Error("Video could not be probed with FFprobe.")) : resolve(stdout));
  });
  const parsed = JSON.parse(output) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  const stream = parsed.streams?.find((entry) => entry.codec_type === "video");
  const duration = Number(parsed.format?.duration);
  if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0) throw new Error("Video probe did not return valid dimensions and duration.");
  return { width: stream.width, height: stream.height, duration };
}

export async function compositeTrustedTypography(video: string, overlay: string) {
  const [videoProbe, overlayInfo] = await Promise.all([
    probeVideoDimensions(video),
    sharp(overlay, { limitInputPixels: 80_000_000 }).metadata(),
  ]);
  if (!overlayInfo.width || !overlayInfo.height || videoProbe.width !== overlayInfo.width || videoProbe.height !== overlayInfo.height) {
    throw new Error("Typography overlay dimensions must match the video dimensions.");
  }

  await fs.mkdir(exportsDir(), { recursive: true });
  const output = path.join(exportsDir(), `final-typography-${randomUUID()}.mp4`);
  try {
    await run(["-y", "-i", video, "-loop", "1", "-i", overlay, "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:shortest=1[v]", "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", output]);
    const finalProbe = await probeVideoDimensions(output);
    if (finalProbe.width !== overlayInfo.width || finalProbe.height !== overlayInfo.height) throw new Error("Final typography composition dimensions do not match the trusted overlay.");
    await verifyEncodedTypographyFrame(output, overlay, finalProbe);
    return output;
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  }
}

export function assertTypographyFrameSimilarity(frame: Buffer, overlay: Buffer, width: number, height: number) {
  const expectedBytes = width * height * 4;
  if (frame.length !== expectedBytes || overlay.length !== expectedBytes) throw new Error("Typography frame comparison requires matching RGBA frames.");
  let totalDifference = 0;
  let opaquePixels = 0;
  for (let offset = 0; offset < overlay.length; offset += 4) {
    if (overlay[offset + 3] === 0) continue;
    totalDifference += Math.abs(frame[offset] - overlay[offset]);
    totalDifference += Math.abs(frame[offset + 1] - overlay[offset + 1]);
    totalDifference += Math.abs(frame[offset + 2] - overlay[offset + 2]);
    opaquePixels += 1;
  }
  if (!opaquePixels || totalDifference / (opaquePixels * 3) > 24) throw new Error("Final typography composition exceeds the visual tolerance after H.264 encoding.");
}

async function verifyEncodedTypographyFrame(video: string, overlay: string, probe: VideoProbe) {
  await fs.mkdir(exportsDir(), { recursive: true });
  const framePath = path.join(exportsDir(), `typography-check-${randomUUID()}.png`);
  try {
    const timestamp = Math.max(0, Math.min(probe.duration / 2, Math.max(0, probe.duration - 0.01)));
    await run(["-y", "-ss", timestamp.toFixed(3), "-i", video, "-frames:v", "1", framePath]);
    const [frame, trustedOverlay] = await Promise.all([
      sharp(framePath, { limitInputPixels: 80_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(overlay, { limitInputPixels: 80_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    if (frame.info.width !== trustedOverlay.info.width || frame.info.height !== trustedOverlay.info.height) throw new Error("Final typography verification frame dimensions do not match the trusted overlay.");
    assertTypographyFrameSimilarity(frame.data, trustedOverlay.data, frame.info.width, frame.info.height);
  } finally {
    await fs.rm(framePath, { force: true });
  }
}

export async function compositeOverlay(video: string, overlay: string, canvas = "1080:1440") {
  await fs.mkdir(exportsDir(), { recursive: true });
  const output = path.join(exportsDir(), `composite-${randomUUID()}.mp4`);
  try {
    await run(["-y", "-i", video, "-loop", "1", "-i", overlay, "-filter_complex", `[0:v]scale=${canvas}:force_original_aspect_ratio=decrease,pad=${canvas}:(ow-iw)/2:(oh-ih)/2:black[base];[1:v]scale=${canvas},format=rgba[overlay];[base][overlay]overlay=0:0:format=auto`, "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-shortest", output]);
    return output;
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  }
}

export async function concatenateVideos(videos: string[], canvas = "1080:1440") {
  if (!videos.length) throw new Error("At least one completed video is required.");
  await fs.mkdir(exportsDir(), { recursive: true });
  const list = path.join(exportsDir(), `concat-${randomUUID()}.txt`);
  const output = path.join(exportsDir(), `export-${randomUUID()}.mp4`);
  await fs.writeFile(list, videos.map((video) => `file '${video.replace(/'/g, "'\\''")}'`).join("\n"));
  try {
    await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${canvas}:force_original_aspect_ratio=decrease,pad=${canvas}:(ow-iw)/2:(oh-ih)/2:black,fps=30`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output]);
    return output;
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally {
    await fs.rm(list, { force: true });
  }
}
