export type MediaTransportState = "unavailable" | "probe-required" | "verified";

export type MediaTransportCapability = {
  id: "bailian-temporary-upload";
  state: MediaTransportState;
  region: string;
  models: string[];
  expiresAfterSeconds?: number;
  lastVerifiedAt?: string;
  reason?: string;
};

type Environment = Record<string, string | undefined>;

const capabilityId = "bailian-temporary-upload" as const;
const singapore = "ap-southeast-1";
const supportedModels = ["wan2.7-r2v-2026-06-12", "wan3.0-video"];

const probeRequired = (reason?: string): MediaTransportCapability => ({
  id: capabilityId,
  state: "probe-required",
  region: singapore,
  models: supportedModels,
  reason: reason || "Free Singapore temporary-upload transport has not been verified.",
});

function parsedCapability(value: unknown): MediaTransportCapability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.id !== capabilityId || candidate.region !== singapore || !["unavailable", "probe-required", "verified"].includes(String(candidate.state)) || !Array.isArray(candidate.models) || candidate.models.some((model) => typeof model !== "string" || !supportedModels.includes(model))) return null;
  const state = candidate.state as MediaTransportState;
  const models = candidate.models as string[];
  if (!models.length) return null;
  const expiresAfterSeconds = candidate.expiresAfterSeconds;
  const lastVerifiedAt = candidate.lastVerifiedAt;
  if (state === "verified" && (!Number.isInteger(expiresAfterSeconds) || Number(expiresAfterSeconds) <= 0 || typeof lastVerifiedAt !== "string" || Number.isNaN(Date.parse(lastVerifiedAt)))) return null;
  if (expiresAfterSeconds !== undefined && (!Number.isInteger(expiresAfterSeconds) || Number(expiresAfterSeconds) <= 0)) return null;
  if (lastVerifiedAt !== undefined && (typeof lastVerifiedAt !== "string" || Number.isNaN(Date.parse(lastVerifiedAt)))) return null;
  return {
    id: capabilityId,
    state,
    region: singapore,
    models,
    ...(expiresAfterSeconds === undefined ? {} : { expiresAfterSeconds: Number(expiresAfterSeconds) }),
    ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
    ...(typeof candidate.reason === "string" && candidate.reason.trim() ? { reason: candidate.reason.trim() } : {}),
  };
}

export function configuredTransportCapability(environment: Environment = process.env): MediaTransportCapability {
  const raw = environment.TINY_SOHO_BAILIAN_TEMPORARY_UPLOAD_CAPABILITY;
  if (!raw) return probeRequired();
  try {
    return parsedCapability(JSON.parse(raw)) || probeRequired("The configured temporary-upload capability record is invalid.");
  } catch {
    return probeRequired("The configured temporary-upload capability record is invalid.");
  }
}

export function effectiveTransportCapability(capability: MediaTransportCapability, providerModel: string): MediaTransportCapability {
  if (capability.id !== capabilityId || capability.region !== singapore) return { ...probeRequired("Temporary upload is only eligible for the exact Singapore workspace."), state: "unavailable" };
  if (!capability.models.includes(providerModel)) return { ...capability, state: "unavailable", reason: "Temporary upload has not been verified for this model." };
  return capability;
}
