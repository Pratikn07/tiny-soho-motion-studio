import { getModel, normalizeMediaRole } from "./models";
import { uploadBailianTemporaryAsset } from "./media-transport/bailian";
import { resolveProviderMedia, type ProviderMediaResolution, type ResolveProviderMediaOptions } from "./media-transport/resolve";
import type { Job, createStore } from "./store";

type StoredMedia = { assetId?: unknown; role?: unknown; publicUrl?: unknown; referenceVoiceAssetId?: unknown; referenceVoicePublicUrl?: unknown };
type ResolveDependencies = Pick<ResolveProviderMediaOptions, "capability" | "readFile" | "temporaryUpload">;

function storedMediaFor(job: Job): StoredMedia[] {
  const options = JSON.parse(job.options) as { media?: unknown; inputRoles?: unknown };
  if (Array.isArray(options.media)) return options.media as StoredMedia[];
  const assetIds = JSON.parse(job.inputAssetIds) as unknown;
  const roles = options.inputRoles;
  if (!Array.isArray(assetIds) || !Array.isArray(roles) || assetIds.length !== roles.length) throw new Error("Job is missing explicit media roles and cannot be submitted safely.");
  return assetIds.map((assetId, index) => ({ assetId, role: roles[index] }));
}

export async function resolveJobMedia(db: ReturnType<typeof createStore>, job: Job, dependencies: ResolveDependencies = {}): Promise<ProviderMediaResolution> {
  const model = getModel(job.modelId);
  const media = storedMediaFor(job).map((stored) => {
    if (typeof stored.assetId !== "string" || typeof stored.role !== "string") throw new Error("Job is missing a valid media asset or role.");
    const asset = db.getAsset(stored.assetId);
    if (!asset) throw new Error("Referenced asset is missing.");
    const role = normalizeMediaRole(stored.role);
    if (stored.publicUrl !== undefined && typeof stored.publicUrl !== "string") throw new Error("Media public URL is invalid.");
    if (stored.referenceVoiceAssetId === undefined) return { role, asset, ...(stored.publicUrl ? { publicUrl: stored.publicUrl } : {}) };
    if (model.family !== "wan2.7-r2v" || !["reference-image", "reference-video"].includes(role)) throw new Error("Reference voice is supported only for Wan 2.7 reference image or video media.");
    if (typeof stored.referenceVoiceAssetId !== "string") throw new Error("Reference voice is missing a valid asset ID.");
    const voice = db.getAsset(stored.referenceVoiceAssetId);
    if (!voice) throw new Error("Reference voice asset is missing.");
    if (voice.projectId && voice.projectId !== job.projectId) throw new Error("Reference voice must belong to the same project.");
    if (!voice.mime.startsWith("audio/")) throw new Error("Reference voice requires an audio asset.");
    if (stored.referenceVoicePublicUrl !== undefined && typeof stored.referenceVoicePublicUrl !== "string") throw new Error("Reference voice public URL is invalid.");
    return { role, asset, ...(stored.publicUrl ? { publicUrl: stored.publicUrl } : {}), referenceVoice: { asset: voice, ...(stored.referenceVoicePublicUrl ? { publicUrl: stored.referenceVoicePublicUrl } : {}) } };
  });
  return resolveProviderMedia({
    model,
    media,
    temporaryUpload: dependencies.temporaryUpload || uploadBailianTemporaryAsset,
    ...dependencies,
  });
}
