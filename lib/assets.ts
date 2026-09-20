import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import sharp from "sharp";
import { assetsDir } from "./config";
import type { Asset } from "./store";

export type PublicAsset = Omit<Asset, "path" | "provenance">;
export type SavedAsset = {
  path: string;
  hash: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
  container: string | null;
  fps?: number | null;
  sizeBytes?: number;
};
export type ProviderDownload = { temporaryPath: string; mime: string; sizeBytes: number; hash: string };
type ProviderDownloadOptions = {
  maximumBytes?: number;
  resolveAddresses?: (hostname: string) => Promise<Array<{ address: string }>>;
  requestResponse?: () => Promise<ProviderResultResponse>;
};
type ProviderResultResponse = { statusCode: number; contentType?: string; contentLength?: string; body: AsyncIterable<Uint8Array>; abort?: (reason: Error) => void };

export const assetLimits = {
  uploadBytes: 25 * 1024 * 1024,
  providerResultBytes: 500 * 1024 * 1024,
  exportBytes: 1024 * 1024 * 1024,
} as const;

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
const providerStorageDomains = ["aliyuncs.com", "alicdn.com"];

export function toPublicAsset(asset: Asset): PublicAsset {
  const { path: _path, provenance: _provenance, ...publicAsset } = asset;
  return publicAsset;
}

export function extensionForMime(mime: string) {
  const extension = mimeExtensions[mime];
  if (!extension) throw new Error(`Unsupported asset MIME type: ${mime}.`);
  return extension;
}

export function isAllowedProviderResultUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !hostname.includes(":") && providerStorageDomains.some((domain) => hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export async function saveAsset(bytes: Buffer, _name: string, mime: string) {
  if (bytes.length > assetLimits.uploadBytes) throw new Error("Uploads must be 25 MB or smaller.");
  const temporaryPath = await writeBufferToTemporaryFile(bytes);
  return adoptTemporaryAsset({ temporaryPath, mime, sizeBytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex"), maximumBytes: assetLimits.uploadBytes });
}

export async function adoptAssetFile(sourcePath: string, mime: string) {
  const copied = await copyToTemporaryFile(sourcePath, assetLimits.exportBytes);
  return adoptTemporaryAsset({ ...copied, mime, maximumBytes: assetLimits.exportBytes });
}

export async function downloadProviderAsset(url: string, options: ProviderDownloadOptions = {}): Promise<ProviderDownload> {
  if (!isAllowedProviderResultUrl(url)) throw new Error("Provider result URL is not an approved Alibaba HTTPS storage host.");
  const hostname = new URL(url).hostname;
  const addresses = await (options.resolveAddresses || defaultResolveAddresses)(hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateOrSpecialAddress(address))) throw new Error("Provider result URL resolved to an unsafe network address.");
  const maximumBytes = options.maximumBytes ?? assetLimits.providerResultBytes;
  const response = options.requestResponse ? await options.requestResponse() : await requestProviderResult(url, addresses);
  if (response.statusCode >= 300 && response.statusCode < 400) rejectProviderResponse(response, "Provider result redirects are not accepted.");
  if (response.statusCode < 200 || response.statusCode >= 300) rejectProviderResponse(response, `Result download failed (${response.statusCode}).`);
  const mime = response.contentType?.split(";", 1)[0]?.trim().toLowerCase() || "";
  try {
    extensionForMime(mime);
  } catch (error) {
    response.abort?.(error instanceof Error ? error : new Error("Provider result content type is not allowed."));
    throw error;
  }
  const declaredSize = Number(response.contentLength);
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) rejectProviderResponse(response, "Provider result exceeds the configured download limit.");

  const temporaryPath = path.join(await ensureAssetsDirectory(), `.provider-${randomUUID()}.tmp`);
  const deadline = setTimeout(() => response.abort?.(new Error("Provider result download exceeded the 120 second deadline.")), 120_000);
  try {
    const written = await writeReadableToTemporaryFile(response.body, temporaryPath, maximumBytes);
    return { temporaryPath, mime, ...written };
  } catch (error) {
    response.abort?.(error instanceof Error ? error : new Error("Provider result stream failed."));
    await fs.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function rejectProviderResponse(response: ProviderResultResponse, message: string): never {
  const error = new Error(message);
  response.abort?.(error);
  throw error;
}

async function defaultResolveAddresses(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

async function requestProviderResult(url: string, addresses: Array<{ address: string }>): Promise<ProviderResultResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      timeout: 120_000,
      lookup: (_hostname, _options, callback) => {
        const address = addresses[0]?.address;
        if (!address) {
          callback(new Error("Provider result did not resolve to a usable address."), "", 0);
          return;
        }
        callback(null, address, isIP(address));
      },
    }, (response: IncomingMessage) => {
      resolve({
        statusCode: response.statusCode || 0,
        contentType: typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : undefined,
        contentLength: typeof response.headers["content-length"] === "string" ? response.headers["content-length"] : undefined,
        body: response,
        abort: (reason) => response.destroy(reason),
      });
    });
    request.once("timeout", () => request.destroy(new Error("Provider result download timed out.")));
    request.once("error", reject);
    request.end();
  });
}

function isPrivateOrSpecialAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [first, second] = address.split(".").map(Number);
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
    const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedV4 ? isPrivateOrSpecialAddress(mappedV4) : false;
  }
  return true;
}

export async function adoptProviderDownload(download: ProviderDownload) {
  return adoptTemporaryAsset({ ...download, maximumBytes: assetLimits.providerResultBytes });
}

async function adoptTemporaryAsset(input: ProviderDownload & { maximumBytes: number }): Promise<SavedAsset> {
  try {
    if (input.sizeBytes > input.maximumBytes) throw new Error("Asset exceeds the configured size limit.");
    const details = await inspectAssetMedia(input.temporaryPath, input.mime);
    const output = path.join(await ensureAssetsDirectory(), `${input.hash}.${extensionForMime(input.mime)}`);
    try {
      await fs.link(input.temporaryPath, output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return { path: output, hash: input.hash, sizeBytes: input.sizeBytes, ...details };
  } finally {
    await fs.rm(input.temporaryPath, { force: true });
  }
}

async function ensureAssetsDirectory() {
  const directory = assetsDir();
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function writeBufferToTemporaryFile(bytes: Buffer) {
  const temporaryPath = path.join(await ensureAssetsDirectory(), `.asset-${randomUUID()}.tmp`);
  const handle = await fs.open(temporaryPath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporaryPath;
}

async function copyToTemporaryFile(sourcePath: string, maximumBytes: number) {
  const temporaryPath = path.join(await ensureAssetsDirectory(), `.asset-${randomUUID()}.tmp`);
  try {
    const written = await writeReadableToTemporaryFile(createReadStream(sourcePath), temporaryPath, maximumBytes);
    return { temporaryPath, ...written };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeReadableToTemporaryFile(readable: AsyncIterable<Uint8Array>, temporaryPath: string, maximumBytes: number) {
  const handle = await fs.open(temporaryPath, "wx");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    for await (const value of readable) {
      const chunk = Buffer.from(value);
      sizeBytes += chunk.length;
      if (sizeBytes > maximumBytes) throw new Error("Provider result exceeds the configured download limit.");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync();
    return { sizeBytes, hash: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

type Probe = (filePath: string) => Promise<string>;
type AssetMediaMetadata = { width: number | null; height: number | null; duration: number | null; codec: string | null; container: string | null; fps: number | null };

export async function inspectAssetMedia(filePath: string, mime: string, runProbe: Probe = runFfprobe): Promise<AssetMediaMetadata> {
  if (mime.startsWith("image/")) {
    const metadata = await sharp(filePath, { limitInputPixels: 80_000_000 }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Unable to fully decode image asset.");
    return { width: metadata.width, height: metadata.height, duration: null, codec: null, container: null, fps: null };
  }
  if (mime === "video/mp4" || mime === "video/quicktime") return probeVideo(filePath, runProbe);
  if (mime === "audio/mpeg" || mime === "audio/wav") return probeAudio(filePath, runProbe);
  return { width: null, height: null, duration: null, codec: null, container: null, fps: null };
}

async function runFfprobe(filePath: string) {
  const executable = process.env.FFPROBE_PATH || "ffprobe";
  return new Promise<string>((resolve, reject) => {
    execFile(executable, ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", filePath], { maxBuffer: 64 * 1024, timeout: 30_000, killSignal: "SIGKILL" }, (error, stdout) => error ? reject(new Error("Media could not be probed with FFprobe.")) : resolve(stdout));
  });
}

function frameRate(value: unknown) {
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  const result = denominator ? numerator / denominator : Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

async function probeVideo(filePath: string, runProbe: Probe): Promise<AssetMediaMetadata> {
  const output = await runProbe(filePath);
  const parsed = JSON.parse(output) as { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }> };
  const stream = parsed.streams?.find((entry) => entry.codec_type === "video");
  const duration = Number(parsed.format?.duration);
  if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0) throw new Error("Video probe did not return valid dimensions and duration.");
  return { width: stream.width, height: stream.height, duration, codec: stream.codec_name || null, container: parsed.format?.format_name || null, fps: frameRate(stream.r_frame_rate) };
}

async function probeAudio(filePath: string, runProbe: Probe): Promise<AssetMediaMetadata> {
  const output = await runProbe(filePath);
  const parsed = JSON.parse(output) as { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> };
  const stream = parsed.streams?.find((entry) => entry.codec_type === "audio");
  const duration = Number(parsed.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) throw new Error("Audio probe did not return a valid duration.");
  return { width: null, height: null, duration, codec: stream.codec_name || null, container: parsed.format?.format_name || null, fps: null };
}
