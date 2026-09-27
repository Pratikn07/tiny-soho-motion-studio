import { getModel, normalizeMediaRole } from "./models";
import { isSafeBailianTemporaryLocator, uploadBailianTemporaryAsset } from "./media-transport/bailian";
import { resolveProviderMedia, type ProviderLocator, type ProviderMediaResolution, type ResolveProviderMediaOptions } from "./media-transport/resolve";
import type { Job, createStore } from "./store";

type StoredMedia = { assetId?: unknown; role?: unknown; publicUrl?: unknown; referenceVoiceAssetId?: unknown; referenceVoicePublicUrl?: unknown };
type ResolveDependencies = Pick<ResolveProviderMediaOptions, "capability" | "readFile" | "temporaryUpload">;
type StoredJobOptions = { media?: unknown; inputRoles?: unknown; preparedMedia?: unknown };
type PreparedMedia = Record<string, ProviderLocator>;

function storedMediaFor(job: Job, options: StoredJobOptions): StoredMedia[] {
  if (Array.isArray(options.media)) return options.media as StoredMedia[];
  const assetIds = JSON.parse(job.inputAssetIds) as unknown;
  const roles = options.inputRoles;
  if (!Array.isArray(assetIds) || !Array.isArray(roles) || assetIds.length !== roles.length) throw new Error("Job is missing explicit media roles and cannot be submitted safely.");
  return assetIds.map((assetId, index) => ({ assetId, role: roles[index] }));
}

function cachedLocator(options: StoredJobOptions, role: string, assetId: string): ProviderLocator | undefined {
  const prepared = options.preparedMedia;
  if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) return undefined;
  const candidate = (prepared as Record<string, unknown>)[`${role}:${assetId}`];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const locator = candidate as Partial<ProviderLocator>;
  if ((locator.kind !== "public-url" && locator.kind !== "dashscope-oss") || typeof locator.value !== "string" || typeof locator.expiresAt !== "string") return undefined;
  return { kind: locator.kind, value: locator.value, expiresAt: locator.expiresAt };
}

function cacheableLocator(value: string | { url: string; expiresAt?: string }): ProviderLocator | null {
  const result = typeof value === "string" ? { url: value } : value;
  if (!result.expiresAt || Number.isNaN(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now() || !isSafeBailianTemporaryLocator(result.url)) return null;
  return { kind: result.url.startsWith("oss://") ? "dashscope-oss" : "public-url", value: result.url, expiresAt: result.expiresAt };
}

export async function resolveJobMedia(db: ReturnType<typeof createStore>, job: Job, dependencies: ResolveDependencies = {}): Promise<ProviderMediaResolution> {
  const model = getModel(job.modelId);
  const options = JSON.parse(job.options) as StoredJobOptions;
  const prepared: PreparedMedia = options.preparedMedia && typeof options.preparedMedia === "object" && !Array.isArray(options.preparedMedia) ? { ...(options.preparedMedia as PreparedMedia) } : {};
  const media = storedMediaFor(job, options).map((stored) => {
    if (typeof stored.assetId !== "string" || typeof stored.role !== "string") throw new Error("Job is missing a valid media asset or role.");
    const asset = db.getAsset(stored.assetId);
    if (!asset) throw new Error("Referenced asset is missing.");
    const role = normalizeMediaRole(stored.role);
    if (stored.publicUrl !== undefined && typeof stored.publicUrl !== "string") throw new Error("Media public URL is invalid.");
    if (stored.referenceVoiceAssetId === undefined) return { role, asset, ...(stored.publicUrl ? { publicUrl: stored.publicUrl } : {}), ...(cachedLocator(options, role, asset.id) ? { preparedLocator: cachedLocator(options, role, asset.id) } : {}) };
    if (model.family !== "wan2.7-r2v" || !["reference-image", "reference-video"].includes(role)) throw new Error("Reference voice is supported only for Wan 2.7 reference image or video media.");
    if (typeof stored.referenceVoiceAssetId !== "string") throw new Error("Reference voice is missing a valid asset ID.");
    const voice = db.getAsset(stored.referenceVoiceAssetId);
    if (!voice) throw new Error("Reference voice asset is missing.");
    if (voice.projectId && voice.projectId !== job.projectId) throw new Error("Reference voice must belong to the same project.");
    if (!voice.mime.startsWith("audio/")) throw new Error("Reference voice requires an audio asset.");
    if (stored.referenceVoicePublicUrl !== undefined && typeof stored.referenceVoicePublicUrl !== "string") throw new Error("Reference voice public URL is invalid.");
    return { role, asset, ...(stored.publicUrl ? { publicUrl: stored.publicUrl } : {}), ...(cachedLocator(options, role, asset.id) ? { preparedLocator: cachedLocator(options, role, asset.id) } : {}), referenceVoice: { asset: voice, ...(stored.referenceVoicePublicUrl ? { publicUrl: stored.referenceVoicePublicUrl } : {}), ...(cachedLocator(options, "reference-voice", voice.id) ? { preparedLocator: cachedLocator(options, "reference-voice", voice.id) } : {}) } };
  });
  const { temporaryUpload = uploadBailianTemporaryAsset, ...resolutionDependencies } = dependencies;
  return resolveProviderMedia({
    model,
    media,
    temporaryUpload: async (input) => {
      const result = await temporaryUpload(input);
      const locator = cacheableLocator(result);
      if (locator) {
        prepared[`${input.role}:${input.asset.id}`] = locator;
        db.updateJobOptions(job.id, { ...options, preparedMedia: prepared });
      }
      return result;
    },
    ...resolutionDependencies,
  });
}
