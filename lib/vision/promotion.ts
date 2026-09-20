import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { assetsDir } from "@/lib/config";
import { type Asset, createStore, store } from "@/lib/store";
import { getVisionArtifact, getVisionArtifactMetadata, type VisionArtifactMetadata } from "./client";
import { visionArtifactIdSchema } from "./artifacts";

const IMAGE_LIMIT_BYTES = 64 * 1024 * 1024;
const VIDEO_LIMIT_BYTES = 1024 * 1024 * 1024;

const kindMimeTypes = {
  "source-image": ["image/png", "image/jpeg", "image/webp"],
  "typography-overlay": ["image/png"],
  "generation-plate": ["image/png"],
  "rgba-layer": ["image/png"],
  "typography-safety-mask": ["image/png"],
  "segmentation-mask": ["image/png"],
  "raw-video": ["video/mp4"],
  "composed-video": ["video/mp4"],
} as const;

export const promotableVisionKindSchema = z.enum([
  "source-image",
  "typography-overlay",
  "generation-plate",
  "rgba-layer",
  "typography-safety-mask",
  "segmentation-mask",
  "raw-video",
  "composed-video",
]);

export const promoteVisionArtifactRequestSchema = z.object({
  projectId: z.string().min(1).max(128),
  visionArtifactId: visionArtifactIdSchema,
  expectedKind: promotableVisionKindSchema,
  name: z.string().min(1).max(240),
  provenance: z.record(z.string(), z.unknown()).default({}),
});

export type PromoteVisionArtifactRequest = z.infer<typeof promoteVisionArtifactRequestSchema>;
type CoreStore = ReturnType<typeof createStore>;
type PromotionMetadata = Pick<VisionArtifactMetadata, "id" | "kind" | "mimeType" | "sizeBytes">;

type ReadyArtifact = { body: ReadableStream<Uint8Array>; contentType: string };
type VisionSidecarSource = {
  metadata: (artifactId: string) => Promise<PromotionMetadata>;
  content: (artifactId: string) => Promise<ReadyArtifact>;
};

type PromotionDependencies = {
  db?: CoreStore;
  assetDirectory?: string;
  sidecar?: VisionSidecarSource;
};

export async function promoteVisionArtifact(rawRequest: unknown, dependencies: PromotionDependencies = {}): Promise<Asset> {
  const request = promoteVisionArtifactRequestSchema.parse(rawRequest);
  const db = dependencies.db || store();
  if (!db.getProject(request.projectId)) throw new Error("Project not found.");

  const sidecar = dependencies.sidecar || localSidecarSource();
  const metadata = await sidecar.metadata(request.visionArtifactId);
  validateMetadata(metadata, request);
  const content = await sidecar.content(request.visionArtifactId);
  const mime = normalizeMime(content.contentType);
  if (mime !== metadata.mimeType) throw new Error("Vision artifact content type does not match its verified metadata.");

  const directory = dependencies.assetDirectory || assetsDir();
  const persisted = await persistStream(content.body, metadata, directory);
  try {
    const media = metadata.mimeType.startsWith("image/")
      ? await probeImage(persisted.path)
      : await probeVideo(persisted.path);
    return db.addAsset({
      projectId: request.projectId,
      kind: request.expectedKind,
      name: safeAssetName(request.name),
      mime: metadata.mimeType,
      path: persisted.path,
      width: media.width,
      height: media.height,
      duration: media.duration,
      hash: persisted.hash,
      provenance: JSON.stringify({
        ...request.provenance,
        source: "vision-safe-motion",
        vision: {
          artifactId: metadata.id,
          kind: metadata.kind,
          mime: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          promotedAt: new Date().toISOString(),
        },
      }),
    });
  } catch (error) {
    if (persisted.created) await fs.rm(persisted.path, { force: true });
    throw error;
  }
}

function localSidecarSource(): VisionSidecarSource {
  return {
    async metadata(artifactId) {
      const metadata = await getVisionArtifactMetadata(artifactId);
      if ("status" in metadata) throw new Error(metadata.reason);
      return metadata;
    },
    async content(artifactId) {
      const artifact = await getVisionArtifact(artifactId);
      if (artifact.status !== "ready") throw new Error(artifact.status === "not-found" ? "Vision artifact was not found." : artifact.reason);
      return artifact;
    },
  };
}

function validateMetadata(metadata: PromotionMetadata, request: PromoteVisionArtifactRequest) {
  if (metadata.id !== request.visionArtifactId) throw new Error("Vision sidecar metadata did not match the requested artifact.");
  if (metadata.kind !== request.expectedKind) throw new Error("Vision artifact kind does not match the requested promotion kind.");
  const expectedMimes = kindMimeTypes[request.expectedKind] as readonly string[];
  if (!expectedMimes.includes(metadata.mimeType)) throw new Error("Vision artifact MIME type is not valid for the requested promotion kind.");
  const limit = metadata.mimeType.startsWith("video/") ? VIDEO_LIMIT_BYTES : IMAGE_LIMIT_BYTES;
  if (!Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 1 || metadata.sizeBytes > limit) throw new Error("Vision artifact size is outside the allowed promotion limit.");
}

async function persistStream(body: ReadableStream<Uint8Array>, metadata: PromotionMetadata, directory: string) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.vision-promotion-${randomUUID()}.tmp`);
  const handle = await fs.open(temporaryPath, "wx", 0o600);
  const hash = createHash("sha256");
  let written = 0;
  try {
    const reader = body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      written += chunk.value.byteLength;
      if (written > metadata.sizeBytes) throw new Error("Vision artifact stream exceeded its verified size.");
      hash.update(chunk.value);
      await handle.write(chunk.value);
    }
    if (written !== metadata.sizeBytes) throw new Error("Vision artifact stream did not match its verified size.");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  await handle.close();

  const digest = hash.digest("hex");
  const destination = path.join(directory, `${digest}.${extensionForMime(metadata.mimeType)}`);
  let created = false;
  try {
    await fs.link(temporaryPath, destination);
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return { path: destination, hash: digest, created };
}

async function probeImage(filePath: string) {
  const metadata = await sharp(filePath, { limitInputPixels: 80_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Promoted image could not be decoded.");
  return { width: metadata.width, height: metadata.height, duration: null };
}

async function probeVideo(filePath: string) {
  const executable = process.env.FFPROBE_PATH || "ffprobe";
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath], { maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(new Error("Promoted video could not be probed with FFprobe.")) : resolve(stdout));
  });
  const parsed = JSON.parse(output) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(parsed.format?.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Error("Promoted video has invalid metadata.");
  return { width: video.width, height: video.height, duration };
}

function normalizeMime(value: string) { return value.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream"; }
function extensionForMime(mime: string) { return mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "video/mp4" ? "mp4" : "bin"; }
function safeAssetName(name: string) { return name.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "vision-artifact"; }
