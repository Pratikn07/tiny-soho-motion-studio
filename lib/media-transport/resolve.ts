import fs from "node:fs/promises";
import { isIP } from "node:net";
import { isAllowedProviderResultUrl } from "../assets";
import type { ModelCapability, MediaRole } from "../models";
import type { Asset } from "../store";
import { isSafeBailianTemporaryLocator } from "./bailian";
import { configuredTransportCapability, effectiveTransportCapability, type MediaTransportCapability } from "./capability";

export type ProviderLocator = { kind: "data-url" | "public-url" | "dashscope-oss"; value: string; expiresAt?: string };
export type ResolvedProviderMedia = { role: MediaRole; mime: string; locator: ProviderLocator; referenceVoice?: ProviderLocator };
export type ProviderMediaInput = { role: MediaRole; asset: Asset; publicUrl?: string; referenceVoice?: { asset: Asset; publicUrl?: string } };
export type ProviderMediaResolution = { ok: true; media: ResolvedProviderMedia[] } | { ok: false; reason: string };
export type ProviderMediaPreflight = { ok: true } | { ok: false; reason: string };

type TemporaryUpload = (input: { asset: Asset; model: ModelCapability; expiresAfterSeconds: number }) => Promise<string | { url: string; expiresAt?: string }>;
export type ResolveProviderMediaOptions = {
  model: ModelCapability;
  media: ProviderMediaInput[];
  capability?: MediaTransportCapability;
  readFile?: (path: string) => Promise<Buffer>;
  temporaryUpload?: TemporaryUpload;
};

const inlineImageRoles = new Set<MediaRole>(["source-image", "start-image", "end-image", "reference-image"]);
const imageLimitBytes = 20 * 1024 * 1024;
const unavailableReason = (role: string) => `Local ${role.replace("-", " ")} is unavailable because free Singapore URL transport is not verified.`;

export function isSafePublicMediaUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash && !isIP(hostname) && hostname.includes(".") && hostname !== "localhost" && !hostname.endsWith(".local") && !hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

function privateProviderUrl(asset: Asset): { url: string; expiresAt?: string } | null {
  try {
    const provenance = JSON.parse(asset.provenance) as { providerOutput?: { url?: unknown; expiresAt?: unknown } };
    const output = provenance.providerOutput;
    if (!output || typeof output.url !== "string" || !isAllowedProviderResultUrl(output.url)) return null;
    if (output.expiresAt !== undefined && (typeof output.expiresAt !== "string" || Number.isNaN(Date.parse(output.expiresAt)) || Date.parse(output.expiresAt) <= Date.now())) return null;
    return { url: output.url, ...(typeof output.expiresAt === "string" ? { expiresAt: output.expiresAt } : {}) };
  } catch {
    return null;
  }
}

function transportPreflightFor(input: { asset: Asset; publicUrl?: string }, role: MediaRole | "reference-voice", model: ModelCapability, capability?: MediaTransportCapability): ProviderMediaPreflight {
  if (inlineImageRoles.has(role as MediaRole)) return { ok: true };
  if (input.publicUrl !== undefined) return isSafePublicMediaUrl(input.publicUrl) ? { ok: true } : { ok: false, reason: "A supplied public media URL must be a safe HTTPS URL." };
  if (privateProviderUrl(input.asset)) return { ok: true };
  const effective = effectiveTransportCapability(capability || configuredTransportCapability(), model.providerModel);
  return effective.state === "verified" ? { ok: true } : { ok: false, reason: unavailableReason(role) };
}

/** Checks every URL-required input before a durable job exists; it never reads files or uploads media. */
export function preflightProviderMedia(options: Pick<ResolveProviderMediaOptions, "model" | "media" | "capability">): ProviderMediaPreflight {
  for (const input of options.media) {
    const mediaPreflight = transportPreflightFor(input, input.role, options.model, options.capability);
    if (!mediaPreflight.ok) return mediaPreflight;
    if (input.referenceVoice) {
      const voicePreflight = transportPreflightFor(input.referenceVoice, "reference-voice", options.model, options.capability);
      if (!voicePreflight.ok) return voicePreflight;
    }
  }
  return { ok: true };
}

async function locatorFor(input: { asset: Asset; publicUrl?: string }, role: MediaRole, options: ResolveProviderMediaOptions): Promise<ProviderLocator | ProviderMediaResolution> {
  if (inlineImageRoles.has(role)) {
    if (!input.asset.mime.startsWith("image/")) return { ok: false, reason: `${role.replace("-", " ")} requires an image asset.` };
    const bytes = await (options.readFile || fs.readFile)(input.asset.path);
    if (bytes.length > imageLimitBytes) return { ok: false, reason: "Inline reference images must be 20 MB or smaller." };
    return { kind: "data-url", value: `data:${input.asset.mime};base64,${bytes.toString("base64")}` };
  }

  if (input.publicUrl !== undefined) {
    if (!isSafePublicMediaUrl(input.publicUrl)) return { ok: false, reason: "A supplied public media URL must be a safe HTTPS URL." };
    return { kind: "public-url", value: input.publicUrl };
  }

  const existing = privateProviderUrl(input.asset);
  if (existing) return { kind: "public-url", value: existing.url, ...(existing.expiresAt ? { expiresAt: existing.expiresAt } : {}) };

  const capability = effectiveTransportCapability(options.capability || configuredTransportCapability(), options.model.providerModel);
  if (capability.state !== "verified" || !options.temporaryUpload) return { ok: false, reason: unavailableReason(role) };
  const result = await options.temporaryUpload({ asset: input.asset, model: options.model, expiresAfterSeconds: capability.expiresAfterSeconds || 0 });
  const temporary = typeof result === "string" ? { url: result } : result;
  if (!isSafeBailianTemporaryLocator(temporary.url)) return { ok: false, reason: "Temporary upload returned an unsafe provider locator." };
  return { kind: temporary.url.startsWith("oss://") ? "dashscope-oss" : "public-url", value: temporary.url, ...(temporary.expiresAt ? { expiresAt: temporary.expiresAt } : {}) };
}

export async function resolveProviderMedia(options: ResolveProviderMediaOptions): Promise<ProviderMediaResolution> {
  const resolved: ResolvedProviderMedia[] = [];
  for (const input of options.media) {
    const locator = await locatorFor(input, input.role, options);
    if ("ok" in locator) {
      if (!locator.ok) return locator;
    }
    const result = locator as ProviderLocator;
    let referenceVoice: ProviderLocator | undefined;
    if (input.referenceVoice) {
      const voice = await locatorFor(input.referenceVoice, "reference-audio", options);
      if ("ok" in voice) {
        if (!voice.ok) return voice;
      }
      referenceVoice = voice as ProviderLocator;
    }
    resolved.push({ role: input.role, mime: input.asset.mime, locator: result, ...(referenceVoice ? { referenceVoice } : {}) });
  }
  return { ok: true, media: resolved };
}
