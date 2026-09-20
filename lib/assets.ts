import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assetsDir } from "./config";
import type { Asset } from "./store";

export type PublicAsset = Omit<Asset, "path">;

export function toPublicAsset(asset: Asset): PublicAsset {
  const { path: _path, ...publicAsset } = asset;
  return publicAsset;
}

export async function saveAsset(bytes: Buffer, name: string, mime: string) {
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Assets must be 25 MB or smaller.");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "audio/mpeg" ? "mp3" : "bin";
  const output = path.join(assetsDir(), `${hash}.${extension}`);
  await fs.mkdir(assetsDir(), { recursive: true });
  await fs.writeFile(output, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  let width: number | null = null; let height: number | null = null;
  if (mime.startsWith("image/")) { const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata(); width = metadata.width || null; height = metadata.height || null; if (!width || !height) throw new Error("Unable to decode image."); }
  return { path: output, hash, width, height, duration: null };
}

export async function downloadProviderAsset(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !/(aliyuncs\.com|alicdn\.com)$/i.test(parsed.hostname)) throw new Error("Provider result URL is not an approved Alibaba HTTPS host.");
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Result download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 500 * 1024 * 1024) throw new Error("Provider result exceeds 500 MB limit.");
  const mime = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
  return { bytes, mime };
}
