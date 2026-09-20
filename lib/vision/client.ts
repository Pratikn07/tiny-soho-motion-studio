import { z } from "zod";
import { parseVisionArtifactId } from "./artifacts";
import { layerResultSchema, ocrResultSchema, segmentationResultSchema, type LayerResult, type OcrResult, type SegmentationResult } from "./contracts";
import { typographyOverlayResultSchema, type TypographyOverlayResult } from "./overlay";
import { typographyCompositionResultSchema, type TypographyCompositionRequest, type TypographyCompositionResult } from "./composer";
import { generationPlateResultSchema, type GenerationPlateBuildRequest, type GenerationPlateResult } from "./plate";

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8765";
const REQUEST_TIMEOUT_MS = 1_500;
const INFERENCE_REQUEST_TIMEOUT_MS = 60_000;

const acceleratorSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
});

const hardwareSchema = z.object({
  cpu: z.object({ available: z.literal(true), cores: z.number().int().positive(), architecture: z.string().min(1) }),
  mps: acceleratorSchema,
  cuda: acceleratorSchema.extend({ deviceCount: z.number().int().nonnegative() }),
});

const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("tiny-soho-vision"),
  version: z.string().min(1),
  bind: z.object({ host: z.literal("127.0.0.1"), port: z.number().int().positive() }),
  hardware: hardwareSchema,
});

const sidecarCapabilitiesSchema = z.object({
  capabilities: z.array(z.unknown()),
  hardware: hardwareSchema,
});

export type VisionSidecarUnavailable = { status: "unavailable"; reason: string };
export type VisionHealth = z.infer<typeof healthSchema> | VisionSidecarUnavailable;
export type VisionCapabilities = z.infer<typeof sidecarCapabilitiesSchema> | VisionSidecarUnavailable;
export type VisionArtifact = { status: "ready"; body: ReadableStream<Uint8Array>; contentType: string } | { status: "not-found" } | VisionSidecarUnavailable;

export function resolveVisionSidecarUrl(value = process.env.TINY_SOHO_VISION_SIDECAR_URL || DEFAULT_SIDECAR_URL):
  | { ok: true; url: string }
  | { ok: false; reason: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return { ok: false, reason: "Vision sidecar URL must use a loopback host." };
    }
    return { ok: true, url: url.toString().replace(/\/$/, "") };
  } catch {
    return { ok: false, reason: "Vision sidecar URL must use a loopback host." };
  }
}

async function requestSidecar<T>(path: string, schema: z.ZodType<T>, configuredUrl?: string): Promise<T | VisionSidecarUnavailable> {
  const resolved = resolveVisionSidecarUrl(configuredUrl);
  if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };

  try {
    const response = await fetch(`${resolved.url}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `Vision sidecar returned HTTP ${response.status}.` };
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) return { status: "unavailable", reason: "Vision sidecar returned an invalid response." };
    return parsed.data;
  } catch {
    return { status: "unavailable", reason: "Vision sidecar is not running or did not respond in time." };
  }
}

export function getVisionHealth(configuredUrl?: string): Promise<VisionHealth> {
  return requestSidecar("/health", healthSchema, configuredUrl);
}

export function getVisionCapabilities(configuredUrl?: string): Promise<VisionCapabilities> {
  return requestSidecar("/v1/capabilities", sidecarCapabilitiesSchema, configuredUrl);
}

async function submitVisionUpload<T>(path: string, formData: FormData, schema: z.ZodType<T>, configuredUrl?: string): Promise<T | VisionSidecarUnavailable> {
  const resolved = resolveVisionSidecarUrl(configuredUrl);
  if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };
  try {
    const response = await fetch(`${resolved.url}${path}`, { body: formData, method: "POST", cache: "no-store", signal: AbortSignal.timeout(INFERENCE_REQUEST_TIMEOUT_MS) });
    if (!response.ok) return { status: "unavailable", reason: `Vision sidecar returned HTTP ${response.status}.` };
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) return { status: "unavailable", reason: "Vision sidecar returned an invalid response." };
    return parsed.data;
  } catch {
    return { status: "unavailable", reason: "Vision sidecar is not running or did not respond in time." };
  }
}

export function runVisionOcr(formData: FormData, configuredUrl?: string): Promise<OcrResult | VisionSidecarUnavailable> {
  return submitVisionUpload("/v1/ocr", formData, ocrResultSchema, configuredUrl);
}

export function runVisionSegmentation(formData: FormData, configuredUrl?: string): Promise<SegmentationResult | VisionSidecarUnavailable> {
  return submitVisionUpload("/v1/segment", formData, segmentationResultSchema, configuredUrl);
}

export function runVisionLayers(formData: FormData, configuredUrl?: string): Promise<LayerResult | VisionSidecarUnavailable> {
  return submitVisionUpload("/v1/layers", formData, layerResultSchema, configuredUrl);
}

export function createVisionTypographyOverlay(formData: FormData, configuredUrl?: string): Promise<TypographyOverlayResult | VisionSidecarUnavailable> {
  return submitVisionUpload("/v1/overlay", formData, typographyOverlayResultSchema, configuredUrl);
}

export async function createVisionGenerationPlate(request: GenerationPlateBuildRequest, configuredUrl?: string): Promise<GenerationPlateResult | VisionSidecarUnavailable> {
  const resolved = resolveVisionSidecarUrl(configuredUrl);
  if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };
  try {
    const response = await fetch(`${resolved.url}/v1/plates`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: AbortSignal.timeout(INFERENCE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `Vision sidecar returned HTTP ${response.status}.` };
    const parsed = generationPlateResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { status: "unavailable", reason: "Vision sidecar returned an invalid response." };
  } catch {
    return { status: "unavailable", reason: "Vision sidecar is not running or did not respond in time." };
  }
}

export async function composeVisionTypography(request: TypographyCompositionRequest, configuredUrl?: string): Promise<TypographyCompositionResult | VisionSidecarUnavailable> {
  const resolved = resolveVisionSidecarUrl(configuredUrl);
  if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };
  try {
    const response = await fetch(`${resolved.url}/v1/compose`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: AbortSignal.timeout(INFERENCE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `Vision sidecar returned HTTP ${response.status}.` };
    const parsed = typographyCompositionResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { status: "unavailable", reason: "Vision sidecar returned an invalid response." };
  } catch {
    return { status: "unavailable", reason: "Vision sidecar is not running or did not respond in time." };
  }
}

export async function getVisionArtifact(artifactId: string, configuredUrl?: string): Promise<VisionArtifact> {
  if (!parseVisionArtifactId(artifactId)) return { status: "not-found" };
  const resolved = resolveVisionSidecarUrl(configuredUrl);
  if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };
  try {
    const response = await fetch(`${resolved.url}/v1/artifacts/${artifactId}`, {
      headers: { accept: "application/octet-stream" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok || !response.body) return { status: "unavailable", reason: `Vision sidecar returned HTTP ${response.status}.` };
    return { status: "ready", body: response.body, contentType: response.headers.get("content-type") || "application/octet-stream" };
  } catch {
    return { status: "unavailable", reason: "Vision sidecar is not running or did not respond in time." };
  }
}
