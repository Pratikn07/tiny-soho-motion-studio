import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata } from "sharp";

import { StudioError } from "@/lib/errors";

const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;
const MAX_GENERATED_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_SOURCE_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_SOURCE_AUDIO_BYTES = 25 * 1024 * 1024;
const sourceImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const sourceVideoMimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const sourceAudioMimeTypes = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4"]);

const mimeTypeForFormat: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function sourceObjectPath(
  ownerUserId: string,
  projectId: string,
  assetId: string,
  originalFilename: string,
) {
  const safeFilename = originalFilename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 160) || "source-image";

  return `owners/${ownerUserId}/projects/${projectId}/sources/${assetId}-${safeFilename}`;
}

export type ValidatedSourceImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sha256: string;
};

export type ValidatedSourceMedia = ValidatedSourceImage | {
  bytes: Buffer;
  mimeType: "video/mp4" | "video/quicktime" | "video/webm" | "audio/mpeg" | "audio/wav" | "audio/x-wav" | "audio/mp4";
  kind: "source-video" | "source-audio";
  width: null;
  height: null;
  sha256: string;
};

type StorageUploadClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type StorageSigningClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
};

export async function validateSourceImage(file: File): Promise<ValidatedSourceImage> {
  if (!sourceImageMimeTypes.has(file.type)) {
    throw new StudioError(400, "unsupported_source_image", "Upload a PNG, JPEG, or WebP source image.");
  }

  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new StudioError(400, "source_image_too_large", "Source images must be 20 MiB or smaller.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new StudioError(400, "unreadable_source_image", "Upload a readable image file.");
  }

  const mimeType = metadata.format ? mimeTypeForFormat[metadata.format] : undefined;
  if (!mimeType || mimeType !== file.type || !metadata.width || !metadata.height) {
    throw new StudioError(400, "unreadable_source_image", "Upload a readable image file.");
  }

  if (metadata.width * metadata.height > MAX_SOURCE_IMAGE_PIXELS) {
    throw new StudioError(400, "source_image_too_large", "Source image dimensions are too large.");
  }

  return {
    bytes,
    mimeType: mimeType as ValidatedSourceImage["mimeType"],
    width: metadata.width,
    height: metadata.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function validateSourceMedia(file: File): Promise<ValidatedSourceMedia & { kind: "source-image" | "source-video" | "source-audio" }> {
  if (sourceImageMimeTypes.has(file.type)) {
    return { ...await validateSourceImage(file), kind: "source-image" };
  }
  const maxBytes = sourceVideoMimeTypes.has(file.type)
    ? MAX_SOURCE_VIDEO_BYTES
    : sourceAudioMimeTypes.has(file.type)
      ? MAX_SOURCE_AUDIO_BYTES
      : 0;
  if (!maxBytes) {
    throw new StudioError(400, "unsupported_source_media", "Upload a PNG, JPEG, WebP, MP4, MOV, WebM, MP3, WAV, or M4A source file.");
  }
  if (!file.size || file.size > maxBytes) {
    throw new StudioError(400, "source_media_too_large", "This source media file is too large.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    bytes,
    mimeType: file.type as Exclude<ValidatedSourceMedia["mimeType"], ValidatedSourceImage["mimeType"]>,
    kind: sourceVideoMimeTypes.has(file.type) ? "source-video" : "source-audio",
    width: null,
    height: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function uploadSourceImage(input: {
  client: StorageUploadClient;
  ownerUserId: string;
  projectId: string;
  assetId: string;
  file: File;
}) {
  const image = await validateSourceImage(input.file);
  const objectPath = sourceObjectPath(
    input.ownerUserId,
    input.projectId,
    input.assetId,
    input.file.name,
  );
  const { error } = await input.client.storage
    .from("creative-studio")
    .upload(objectPath, image.bytes, { contentType: image.mimeType, upsert: false });

  if (error) {
    throw new StudioError(502, "studio_storage_upload_failed", "Source image upload failed.");
  }

  return { ...image, objectPath };
}

export async function uploadSourceMedia(input: {
  client: StorageUploadClient;
  ownerUserId: string;
  projectId: string;
  assetId: string;
  file: File;
}) {
  const media = await validateSourceMedia(input.file);
  const objectPath = sourceObjectPath(
    input.ownerUserId,
    input.projectId,
    input.assetId,
    input.file.name,
  );
  const { error } = await input.client.storage
    .from("creative-studio")
    .upload(objectPath, media.bytes, { contentType: media.mimeType, upsert: false });
  if (error) {
    throw new StudioError(502, "studio_storage_upload_failed", "Source media upload failed.");
  }
  return { ...media, objectPath };
}

export async function signAssetDownload(client: StorageSigningClient, objectPath: string) {
  const { data, error } = await client.storage
    .from("creative-studio")
    .createSignedUrl(objectPath, 300);
  if (error || !data?.signedUrl) {
    throw new StudioError(502, "studio_storage_sign_failed", "Asset download is temporarily unavailable.");
  }
  return data.signedUrl;
}

export async function ingestGeneratedVideo(input: {
  client: StorageUploadClient;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  ownerUserId: string;
  projectId: string;
  assetId: string;
  providerUrl: string;
}) {
  let providerUrl: URL;
  try {
    providerUrl = new URL(input.providerUrl);
  } catch {
    throw new StudioError(502, "provider_result_invalid", "Provider result URL is invalid.");
  }
  if (providerUrl.protocol !== "https:") {
    throw new StudioError(502, "provider_result_invalid", "Provider result URL is invalid.");
  }

  const response = await (input.fetcher ?? fetch)(providerUrl, { signal: AbortSignal.timeout(60_000) });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || contentType !== "video/mp4" || contentLength > MAX_GENERATED_VIDEO_BYTES) {
    throw new StudioError(502, "provider_result_invalid", "Provider result could not be imported.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_GENERATED_VIDEO_BYTES) {
    throw new StudioError(502, "provider_result_invalid", "Provider result could not be imported.");
  }

  const objectPath = `owners/${input.ownerUserId}/projects/${input.projectId}/generated/${input.assetId}.mp4`;
  const { error } = await input.client.storage
    .from("creative-studio")
    .upload(objectPath, bytes, { contentType: "video/mp4", upsert: false });
  if (error) {
    throw new StudioError(502, "studio_storage_upload_failed", "Generated video upload failed.");
  }

  return {
    objectPath,
    bytes,
    mimeType: "video/mp4" as const,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
