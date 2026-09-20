import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata } from "sharp";

import { StudioError } from "@/lib/errors";

const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;
const sourceImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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

export async function signAssetDownload(client: StorageSigningClient, objectPath: string) {
  const { data, error } = await client.storage
    .from("creative-studio")
    .createSignedUrl(objectPath, 300);
  if (error || !data?.signedUrl) {
    throw new StudioError(502, "studio_storage_sign_failed", "Asset download is temporarily unavailable.");
  }
  return data.signedUrl;
}
