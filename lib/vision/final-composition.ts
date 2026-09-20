import fs from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import { adoptAssetFile, type SavedAsset } from "@/lib/assets";
import { compositeTrustedTypography, probeVideoDimensions, type VideoProbe } from "@/lib/media";
import { getModel } from "@/lib/models";
import { type Asset, createStore, store } from "@/lib/store";
import { type OcrRegion } from "./contracts";
import { motionPackageV2Fingerprint, motionPackageV2Schema, type MotionPackageV2 } from "./motion-package-v2";

const assetIdSchema = z.string().min(1).max(256);

export const finalCompositionRequestSchema = z.object({
  package: motionPackageV2Schema,
  rawVideoAssetId: assetIdSchema,
}).strict();

export type FinalCompositionRequest = z.infer<typeof finalCompositionRequestSchema>;

type CoreStore = ReturnType<typeof createStore>;
type Dependencies = {
  db?: CoreStore;
  verifyOverlay?: (source: Asset, overlay: Asset, regions: OcrRegion[]) => Promise<void>;
  composite?: (videoPath: string, overlayPath: string) => Promise<string>;
  adoptAsset?: (sourcePath: string, mime: string) => Promise<SavedAsset>;
  probeVideo?: (filePath: string) => Promise<VideoProbe>;
};

export async function composeMotionPackageFinal(raw: unknown, dependencies: Dependencies = {}) {
  const request = finalCompositionRequestSchema.parse(raw);
  const db = dependencies.db || store();
  const pkg = request.package;
  const source = requireProjectAsset(db, pkg.sourceAssetId, pkg.projectId, "source image", "source-image", "image/png");
  const overlay = requireProjectAsset(db, pkg.typographyOverlayAssetId, pkg.projectId, "typography overlay", "typography-overlay", "image/png");
  const rawVideo = requireProjectAsset(db, request.rawVideoAssetId, pkg.projectId, "raw Wan video", undefined, "video/mp4");
  assertTrustedSourceLineage(source);
  assertTrustedOverlayLineage(source, overlay);
  assertRawVideoLineage(db, rawVideo, pkg);

  const probeVideo = dependencies.probeVideo || probeVideoDimensions;
  const videoProbe = await probeVideo(rawVideo.path);
  if (videoProbe.width !== overlay.width || videoProbe.height !== overlay.height) {
    throw new Error("Raw Wan video dimensions must match the trusted typography overlay dimensions.");
  }
  if (source.width !== overlay.width || source.height !== overlay.height) {
    throw new Error("Trusted typography overlay dimensions must match the source image dimensions.");
  }

  const verifyOverlay = dependencies.verifyOverlay || verifyTrustedTypographyOverlay;
  await verifyOverlay(source, overlay, pkg.analysis.ocr.regions);

  let temporaryOutput: string | undefined;
  try {
    temporaryOutput = await (dependencies.composite || compositeTrustedTypography)(rawVideo.path, overlay.path);
    const saved = await (dependencies.adoptAsset || adoptAssetFile)(temporaryOutput, "video/mp4");
    return db.addAsset({
      projectId: pkg.projectId,
      kind: "final-video",
      name: "Final typography composition",
      mime: "video/mp4",
      path: saved.path,
      width: saved.width,
      height: saved.height,
      duration: saved.duration,
      hash: saved.hash,
      provenance: JSON.stringify({
        source: "vision-final-typography-composition",
        rawVideoAssetId: rawVideo.id,
        typographyOverlayAssetId: overlay.id,
        motionPackage: {
          fingerprint: motionPackageV2Fingerprint(pkg),
          sourceAssetId: pkg.sourceAssetId,
          generationPlateAssetId: pkg.generationPlateAssetId,
          typographyOverlayAssetId: pkg.typographyOverlayAssetId,
          plateTextRemoved: pkg.plateTextRemoved,
        },
        media: { codec: saved.codec, container: saved.container },
      }),
    });
  } finally {
    if (temporaryOutput) await fs.rm(temporaryOutput, { force: true });
  }
}

export async function verifyTrustedTypographyOverlay(source: Pick<Asset, "path" | "width" | "height">, overlay: Pick<Asset, "path">, regions: OcrRegion[]) {
  const [sourceImage, overlayImage] = await Promise.all([
    sharp(source.path, { limitInputPixels: 80_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(overlay.path, { limitInputPixels: 80_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (!sourceImage.info.width || !sourceImage.info.height || sourceImage.info.width !== overlayImage.info.width || sourceImage.info.height !== overlayImage.info.height) {
    throw new Error("Trusted typography overlay dimensions must match the source image dimensions.");
  }
  if (source.width !== sourceImage.info.width || source.height !== sourceImage.info.height) throw new Error("Source image metadata does not match the decoded typography source.");

  const padding = Math.max(2, Math.min(64, Math.round(Math.min(sourceImage.info.width, sourceImage.info.height) * 0.01)));
  // Pillow and librsvg differ by at most one edge pixel when rasterizing the
  // same normalized polygon. Use an inner mask for required coverage and an
  // outer mask for transparency, while requiring every visible overlay pixel
  // to exactly match the source regardless of mask membership.
  const innerMask = await typographySafetyMask(sourceImage.info.width, sourceImage.info.height, regions, Math.max(0, padding - 1));
  const outerMask = await typographySafetyMask(sourceImage.info.width, sourceImage.info.height, regions, padding + 1);
  const channels = sourceImage.info.channels;
  for (let pixel = 0, offset = 0; pixel < outerMask.length; pixel += 1, offset += channels) {
    if (!outerMask[pixel] && overlayImage.data[offset + 3] !== 0) {
      throw new Error("Trusted typography overlay must be transparent outside the typography safety mask.");
    }
    if (innerMask[pixel] || overlayImage.data[offset + 3] !== 0) {
      for (let channel = 0; channel < channels; channel += 1) {
        if (sourceImage.data[offset + channel] !== overlayImage.data[offset + channel]) {
          throw new Error("Trusted typography overlay must preserve original source pixels inside the typography safety mask.");
        }
      }
    }
  }
}

function requireProjectAsset(db: CoreStore, assetId: string, projectId: string, label: string, expectedKind?: string, expectedMime?: string) {
  const asset = db.getAsset(assetId);
  if (!asset || asset.projectId !== projectId) throw new Error(`Final typography composition ${label} must belong to the same project.`);
  if (expectedKind && asset.kind !== expectedKind) throw new Error(`Final typography composition ${label} must be a ${expectedKind} asset.`);
  if (expectedMime && asset.mime !== expectedMime) throw new Error(`Final typography composition ${label} must be ${expectedMime}.`);
  return asset;
}

function assertTrustedOverlayLineage(source: Asset, overlay: Asset) {
  const provenance = parseProvenance(overlay, "Typography overlay");
  const vision = record(provenance.vision);
  if (provenance.source !== "vision-safe-motion" || provenance.sourceAssetId !== source.id || vision?.kind !== "typography-overlay" || vision.producer !== "overlay-builder") {
    throw new Error("Typography overlay does not have trusted source-pixel provenance.");
  }
}

function assertTrustedSourceLineage(source: Asset) {
  const provenance = parseProvenance(source, "Source image");
  const vision = record(provenance.vision);
  if (provenance.source !== "vision-safe-motion" || vision?.kind !== "source-image") {
    throw new Error("Source image does not have trusted source-image provenance.");
  }
}

function assertRawVideoLineage(db: CoreStore, rawVideo: Asset, pkg: MotionPackageV2) {
  const provenance = parseProvenance(rawVideo, "Raw Wan video");
  const internal = record(provenance.internalProvenance);
  const job = typeof provenance.jobId === "string" ? db.getJob(provenance.jobId) : null;
  const jobOptions = job ? parseJobOptions(job.options) : null;
  const jobInternal = jobOptions && record(jobOptions.internalProvenance);
  const media = jobOptions?.media;
  const rawProviderTaskId = typeof provenance.providerTaskId === "string" && provenance.providerTaskId.trim() ? provenance.providerTaskId : null;
  const jobProviderTaskId = typeof job?.providerTaskId === "string" && job.providerTaskId.trim() ? job.providerTaskId : null;
  let modelFamily: string | undefined;
  try {
    modelFamily = job ? getModel(job.modelId).family : undefined;
  } catch {
    modelFamily = undefined;
  }
  const inputAssetIds = job ? parseInputAssetIds(job.inputAssetIds) : null;
  const hasExpectedMedia = Array.isArray(media) && media.length === 1 && record(media[0])?.assetId === pkg.generationPlateAssetId && record(media[0])?.role === "start-image";
  if (!job || !rawProviderTaskId || !jobProviderTaskId || job.projectId !== pkg.projectId || job.status !== "completed" || job.outputAssetId !== rawVideo.id || jobProviderTaskId !== rawProviderTaskId || job.task !== "image-to-video" || modelFamily !== "wan3" || !inputAssetIds || inputAssetIds.length !== 1 || inputAssetIds[0] !== pkg.generationPlateAssetId || !hasExpectedMedia || internal?.source !== "vision-motion-package-v2" || jobInternal?.source !== "vision-motion-package-v2" || internal.packageFingerprint !== motionPackageV2Fingerprint(pkg) || jobInternal.packageFingerprint !== internal.packageFingerprint || internal.sourceAssetId !== pkg.sourceAssetId || jobInternal.sourceAssetId !== internal.sourceAssetId || internal.generationPlateAssetId !== pkg.generationPlateAssetId || jobInternal.generationPlateAssetId !== internal.generationPlateAssetId || internal.typographyOverlayAssetId !== pkg.typographyOverlayAssetId || jobInternal.typographyOverlayAssetId !== internal.typographyOverlayAssetId) {
    throw new Error("Raw Wan video generation job lineage does not match the trusted MotionPackage.");
  }
}

function parseProvenance(asset: Asset, label: string) {
  try {
    const parsed = JSON.parse(asset.provenance) as unknown;
    const result = record(parsed);
    if (!result) throw new Error();
    return result;
  } catch {
    throw new Error(`${label} provenance is invalid.`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJobOptions(value: string) {
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseInputAssetIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((assetId) => typeof assetId === "string") ? parsed : null;
  } catch {
    return null;
  }
}

async function typographySafetyMask(width: number, height: number, regions: OcrRegion[], padding: number) {
  if (!regions.length) return Buffer.alloc(width * height);
  const points = regions.map((region) => `<polygon points="${region.polygon.map((point) => `${Math.round(point.x * width)},${Math.round(point.y * height)}`).join(" ")}" />`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="#ffffff" shape-rendering="crispEdges">${points}</g></svg>`;
  const base = await sharp(Buffer.from(svg)).resize(width, height, { fit: "fill", kernel: sharp.kernel.nearest }).extractChannel("alpha").raw().toBuffer();
  return dilateMask(base, width, height, padding);
}

function dilateMask(base: Buffer, width: number, height: number, padding: number) {
  if (!padding) return base;
  const horizontal = Buffer.alloc(base.length);
  const horizontalDeltas = new Int32Array(width + 1);
  for (let y = 0; y < height; y += 1) {
    horizontalDeltas.fill(0);
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!base[row + x]) continue;
      horizontalDeltas[Math.max(0, x - padding)] += 1;
      horizontalDeltas[Math.min(width, x + padding + 1)] -= 1;
    }
    let coverage = 0;
    for (let x = 0; x < width; x += 1) {
      coverage += horizontalDeltas[x];
      horizontal[row + x] = coverage > 0 ? 255 : 0;
    }
  }

  const verticalDeltas = new Int32Array(height + 1);
  for (let x = 0; x < width; x += 1) {
    verticalDeltas.fill(0);
    for (let y = 0; y < height; y += 1) {
      if (!horizontal[y * width + x]) continue;
      verticalDeltas[Math.max(0, y - padding)] += 1;
      verticalDeltas[Math.min(height, y + padding + 1)] -= 1;
    }
    let coverage = 0;
    for (let y = 0; y < height; y += 1) {
      coverage += verticalDeltas[y];
      base[y * width + x] = coverage > 0 ? 255 : 0;
    }
  }
  return base;
}
