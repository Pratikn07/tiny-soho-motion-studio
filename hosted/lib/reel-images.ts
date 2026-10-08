import { createHash, randomUUID } from "node:crypto";

import sharp, { type Metadata } from "sharp";
import { z } from "zod";

import { StudioError } from "@/lib/errors";
import type { ReelImage, ReelImageCheck, ReelUpload, ReelView } from "@/lib/reels";

/**
 * Images the creator makes for a reel. They go to the existing private `creative-studio` bucket under
 * owners/{owner}/reels/{reel}/images/, uploaded straight from the browser to a signed URL (Vercel's 4.5 MB request
 * limit never applies), then checked here and recorded in the reel's document. No database table is involved.
 */
export const REEL_IMAGE_BUCKET = "creative-studio";
export const REEL_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_REEL_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const VIEW_SECONDS = 60 * 60;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const FORMATS: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

export const imageUploadRequestSchema = z.object({
  file: z.string().min(1).max(80),
  mime: z.enum(REEL_IMAGE_MIMES),
  size: z.number().int().min(1).max(MAX_REEL_IMAGE_BYTES),
});
export const imageUploadFinishSchema = z.object({ file: z.string().min(1).max(80), uploadId: z.string().uuid() });

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUploadUrl: (path: string, options?: { upsert?: boolean }) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
      createSignedUrls: (paths: string[], seconds: number) => Promise<{ data: Array<{ path: string | null; signedUrl: string }> | null; error: unknown }>;
      list: (folder: string, options: { search: string; limit: number }) => Promise<{ data: Array<{ name: string }> | null; error: unknown }>;
      download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
      remove: (paths: string[]) => Promise<{ error: unknown }>;
    };
  };
};

const imageFolder = (ownerId: string, reelId: string) => `owners/${ownerId}/reels/${reelId}/images`;
const fileStem = (file: string) => file.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "image";

/** Parses an aspect like "4:5" into width / height. */
export function aspectRatio(aspect: string) {
  const match = aspect.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) / Number(match[2]) : null;
}

const ratioLabel = (ratio: number) => {
  const known: Array<[string, number]> = [["9:16", 9 / 16], ["4:5", 4 / 5], ["2:3", 2 / 3], ["3:4", 3 / 4], ["1:1", 1], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:9", 16 / 9]];
  const [label, value] = known.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best));
  return Math.abs(value - ratio) / value < 0.03 ? label : `${ratio.toFixed(2)}:1`;
};

/**
 * Instant checks on an uploaded image: what the storyboard asked for (aspect, transparent background) and whether
 * it is big enough. "fail" means it won't work as it is; "warn" means it can be used but may look off.
 */
export function evaluateReelImage(info: { width: number; height: number; hasAlpha: boolean; transparentShare: number }, want: Pick<ReelImage, "aspect" | "background">): ReelImageCheck[] {
  const checks: ReelImageCheck[] = [];
  const target = aspectRatio(want.aspect);
  const actual = info.width / info.height;
  if (target) {
    const off = Math.abs(actual / target - 1);
    checks.push(off <= 0.04 ? { code: "aspect", level: "ok", message: `Shape ${want.aspect}, as asked.` }
      : { code: "aspect", level: "warn", message: `Shape is ${ratioLabel(actual)}; the storyboard asked for ${want.aspect}. It will be cropped or padded.` });
  }
  if (want.background === "transparent") {
    checks.push(!info.hasAlpha ? { code: "transparent", level: "fail", message: "Needs a transparent background. Save it as a PNG or WebP with transparency." }
      : info.transparentShare < 0.05 ? { code: "transparent", level: "fail", message: "The background isn't transparent. Remove the background and upload it again." }
        : { code: "transparent", level: "ok", message: "Transparent background, as asked." });
  } else if (info.transparentShare > 0.2) {
    checks.push({ code: "transparent", level: "warn", message: "Has a transparent background; this image was meant to fill its frame." });
  }
  const shorter = Math.min(info.width, info.height);
  checks.push(shorter < 800 ? { code: "size", level: "warn", message: `Small (${info.width}×${info.height}). 1080 px or more on the short side looks sharper.` }
    : { code: "size", level: "ok", message: `${info.width}×${info.height} px.` });
  return checks;
}

/** Reads an uploaded file: checks it really is the image type it claims, and measures it. */
export async function inspectReelImage(bytes: Buffer, mime: string) {
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new StudioError(400, "unreadable_image", "That file isn't a readable image. Upload a PNG, JPEG or WebP.");
  }
  if (!metadata.format || FORMATS[metadata.format] !== mime || !metadata.width || !metadata.height) {
    throw new StudioError(400, "unreadable_image", "That file isn't a readable PNG, JPEG or WebP.");
  }
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const hasAlpha = Boolean(metadata.hasAlpha);
  let transparentShare = 0;
  if (hasAlpha) {
    // A small copy is enough to tell how much of the picture is see-through.
    const { data, info } = await sharp(bytes).resize({ width: 256, height: 256, fit: "inside" }).ensureAlpha().extractChannel("alpha").raw()
      .toBuffer({ resolveWithObject: true });
    let clear = 0;
    for (let index = 0; index < data.length; index += 1) if (data[index] < 16) clear += 1;
    transparentShare = clear / (info.width * info.height);
  }
  return { width, height, hasAlpha, transparentShare, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The storage side of reel images for one owner and reel. */
export class ReelImageStore {
  constructor(private client: StorageClient, private ownerId: string, private reelId: string) {}

  private get bucket() {
    return this.client.storage.from(REEL_IMAGE_BUCKET);
  }

  /** A one-time upload URL for a new version of `file`. */
  async startUpload(input: z.infer<typeof imageUploadRequestSchema>) {
    const uploadId = randomUUID();
    const path = `${imageFolder(this.ownerId, this.reelId)}/${fileStem(input.file)}-${uploadId}.${EXTENSIONS[input.mime]}`;
    const { data, error } = await this.bucket.createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.signedUrl) throw new StudioError(502, "upload_unavailable", "Uploads are temporarily unavailable. Try again.");
    return { uploadId, uploadUrl: data.signedUrl };
  }

  /** Finds the uploaded file, checks it and returns its record. Throws when the upload never arrived. */
  async finishUpload(file: string, uploadId: string, want: ReelImage): Promise<ReelUpload> {
    const folder = imageFolder(this.ownerId, this.reelId);
    const stem = `${fileStem(file)}-${uploadId}`;
    const listed = await this.bucket.list(folder, { search: stem, limit: 5 });
    const object = (listed.data ?? []).find((entry) => entry.name.startsWith(`${stem}.`));
    if (listed.error || !object) throw new StudioError(400, "upload_missing", "The upload didn't finish. Upload the image again.");
    const objectPath = `${folder}/${object.name}`;
    const mime = Object.entries(EXTENSIONS).find(([, ext]) => object.name.endsWith(`.${ext}`))?.[0];
    const downloaded = await this.bucket.download(objectPath);
    if (!mime || downloaded.error || !downloaded.data) throw new StudioError(502, "upload_missing", "The upload didn't finish. Upload the image again.");
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    if (bytes.length > MAX_REEL_IMAGE_BYTES) {
      await this.remove([objectPath]);
      throw new StudioError(400, "image_too_large", "Images must be 25 MB or smaller.");
    }
    let info;
    try {
      info = await inspectReelImage(bytes, mime);
    } catch (error) {
      await this.remove([objectPath]);
      throw error;
    }
    return {
      file, uploadId, objectPath, mime, bytes: bytes.length, width: info.width, height: info.height, sha256: info.sha256,
      uploadedAt: new Date().toISOString(), checks: evaluateReelImage(info, want), review: { status: "pending", notes: "" },
    };
  }

  async remove(paths: string[]) {
    if (paths.length) await this.bucket.remove(paths);
  }

  /** Short-lived links so the page can show the uploaded images and play the voice takes. */
  async withUrls(view: ReelView): Promise<ReelView> {
    const uploads = Object.values(view.document.images ?? {});
    const takes = view.document.voice?.takes ?? [];
    if (!uploads.length && !takes.length) return view;
    const paths = [...uploads.map((upload) => upload.objectPath), ...takes.map((take) => take.objectPath)];
    const { data } = await this.bucket.createSignedUrls(paths, VIEW_SECONDS);
    const byPath = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
    const imageUrls: Record<string, string> = {};
    const voiceUrls: Record<string, string> = {};
    for (const upload of uploads) {
      const url = byPath.get(upload.objectPath);
      if (url) imageUrls[upload.file] = url;
    }
    for (const take of takes) {
      const url = byPath.get(take.objectPath);
      if (url) voiceUrls[take.id] = url;
    }
    return { ...view, imageUrls, voiceUrls };
  }
}
