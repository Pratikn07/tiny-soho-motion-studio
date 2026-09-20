import { getModel, normalizeMediaRole, validateGeneration, type GenerationOptions, type GenerationTask, type MediaRole, type ModelCapability } from "./models";
import type { createStore } from "./store";

export type GenerationMedia = { assetId: string; role: MediaRole; referenceVoiceAssetId?: string };
export type GenerationDraft = {
  projectId: string;
  idempotencyKey: string;
  modelId: string;
  prompt: string;
  media?: Array<{ assetId: string; role: string; referenceVoiceAssetId?: string }>;
  // Compatibility with jobs stored before the normalized media contract.
  inputAssetIds?: string[];
  inputRoles?: string[];
  options?: Record<string, unknown>;
  internalProvenance?: Record<string, unknown>;
};
export type ValidatedGenerationRequest = { projectId: string; idempotencyKey: string; model: ModelCapability; task: GenerationTask; prompt: string; media: GenerationMedia[]; options: GenerationOptions; internalProvenance: Record<string, unknown> | undefined };

const optionNames = new Set(["duration", "resolution", "aspectRatio", "ratio", "promptExtend", "watermark", "audio", "negativePrompt", "size", "n"]);
const mimeForRole: Record<MediaRole, string> = { "source-image": "image/", "start-image": "image/", "end-image": "image/", "reference-image": "image/", "reference-video": "video/", "reference-audio": "audio/", "driving-audio": "audio/", "first-clip": "video/" };
const mib = 1024 * 1024;

export function normalizeGenerationDraft(draft: GenerationDraft) {
  if (!draft.projectId?.trim()) throw new Error("A project is required.");
  if (!draft.idempotencyKey?.trim()) throw new Error("An idempotency key is required.");
  if (!draft.modelId?.trim()) throw new Error("A model is required.");
  if (typeof draft.prompt !== "string") throw new Error("A prompt is required.");
  const mediaSource: NonNullable<GenerationDraft["media"]> = draft.media ?? (() => {
    const assets = draft.inputAssetIds || []; const roles = draft.inputRoles || [];
    if (assets.length !== roles.length) throw new Error("Every input asset needs a media role.");
    return assets.map((assetId, index) => ({ assetId, role: roles[index] }));
  })();
  if (!Array.isArray(mediaSource)) throw new Error("Media must be a list.");
  const media = mediaSource.map((item) => {
    if (!item || typeof item.assetId !== "string" || !item.assetId.trim() || typeof item.role !== "string") throw new Error("Each media input needs an asset and role.");
    if (item.referenceVoiceAssetId !== undefined && (typeof item.referenceVoiceAssetId !== "string" || !item.referenceVoiceAssetId.trim())) throw new Error("A reference voice needs an asset ID.");
    return { assetId: item.assetId, role: normalizeMediaRole(item.role), ...(item.referenceVoiceAssetId ? { referenceVoiceAssetId: item.referenceVoiceAssetId } : {}) };
  });
  const rawOptions = draft.options || {};
  if (!rawOptions || Array.isArray(rawOptions) || typeof rawOptions !== "object") throw new Error("Generation options must be an object.");
  for (const key of Object.keys(rawOptions)) if (!optionNames.has(key)) throw new Error(`Unsupported generation option: ${key}.`);
  const { ratio, ...rest } = rawOptions as Record<string, unknown>;
  const options: GenerationOptions = { ...rest };
  if (ratio !== undefined) { if (options.aspectRatio !== undefined && options.aspectRatio !== ratio) throw new Error("Use one aspect ratio value."); options.aspectRatio = String(ratio); }
  if (draft.internalProvenance !== undefined && (!draft.internalProvenance || Array.isArray(draft.internalProvenance) || typeof draft.internalProvenance !== "object")) throw new Error("Internal generation provenance must be an object.");
  return { projectId: draft.projectId, idempotencyKey: draft.idempotencyKey, modelId: draft.modelId, prompt: draft.prompt.trim(), media, options, internalProvenance: draft.internalProvenance };
}

export function inferTask(model: ModelCapability, media: GenerationMedia[]): GenerationTask {
  if (media.some((item) => item.role.startsWith("reference-"))) return "reference-to-video";
  if (media.some((item) => item.role === "start-image" || item.role === "end-image")) return "image-to-video";
  if (media.some((item) => item.role === "source-image")) return "image-to-image";
  if (model.tasks.includes("text-to-video")) return "text-to-video";
  if (model.tasks.includes("text-to-image")) return "text-to-image";
  if (model.tasks.includes("image-to-video")) return "image-to-video";
  throw new Error("The selected inputs do not map to a supported task.");
}

export function preflightGeneration(store: ReturnType<typeof createStore>, draft: GenerationDraft, eligibleModels: Set<string>): ValidatedGenerationRequest {
  const normalized = normalizeGenerationDraft(draft);
  const project = store.getProject(normalized.projectId);
  if (!project) throw new Error("Project not found.");
  const model = getModel(normalized.modelId);
  const resolvedAssets = normalized.media.map((input) => {
    const asset = store.getAsset(input.assetId);
    if (!asset) throw new Error(`Referenced asset ${input.assetId} was not found.`);
    if (asset.projectId && asset.projectId !== project.id) throw new Error("Referenced assets must belong to the same project.");
    if (!asset.mime.startsWith(mimeForRole[input.role])) throw new Error(`${input.role.replace("-", " ")} requires a ${mimeForRole[input.role].slice(0, -1)} asset.`);
    return { input, asset };
  });
  const task = inferTask(model, normalized.media);
  const options = { ...model.defaultOptions, ...normalized.options };
  validateGeneration(model, { task, prompt: normalized.prompt, inputRoles: normalized.media.map((input) => input.role), options, freeQuotaConfirmed: eligibleModels.has(model.id) });
  validateMediaMetadata(store, project.id, model, resolvedAssets, options);
  return { projectId: normalized.projectId, idempotencyKey: normalized.idempotencyKey, model, task, prompt: normalized.prompt, media: normalized.media, options, internalProvenance: normalized.internalProvenance };
}

function within(value: number | null, minimum: number, maximum: number) { return value !== null && Number.isFinite(value) && value >= minimum && value <= maximum; }
function exceeds(asset: { sizeBytes?: number | null }, maximum: number) { return asset.sizeBytes !== null && asset.sizeBytes !== undefined && asset.sizeBytes > maximum; }

function validateMediaMetadata(store: ReturnType<typeof createStore>, projectId: string, model: ModelCapability, media: Array<{ input: GenerationMedia; asset: ReturnType<ReturnType<typeof createStore>["getAsset"]> }>, options: GenerationOptions) {
  for (const { input, asset } of media) {
    if (!asset) continue;
    if (input.role === "reference-image" && exceeds(asset, 20 * mib)) throw new Error("Reference images must be 20 MB or smaller.");
    if (input.role === "reference-video") {
      if (!["video/mp4", "video/quicktime"].includes(asset.mime)) throw new Error("Reference video must be MP4 or MOV.");
      if (!within(asset.duration, 1, 30)) throw new Error("Reference video duration must be from 1 to 30 seconds.");
      if (!asset.width || !asset.height || asset.width < 240 || asset.width > 4096 || asset.height < 240 || asset.height > 4096 || asset.width / asset.height < 1 / 8 || asset.width / asset.height > 8) throw new Error("Reference video dimensions are outside the provider limit.");
      if (exceeds(asset, 100 * mib)) throw new Error("Reference video must be 100 MB or smaller.");
    }
    if (input.referenceVoiceAssetId !== undefined) {
      if (model.family !== "wan2.7-r2v" || !["reference-image", "reference-video"].includes(input.role)) throw new Error("Reference voice is supported only for Wan 2.7 reference image or video media.");
      const voice = store.getAsset(input.referenceVoiceAssetId);
      if (!voice || (voice.projectId && voice.projectId !== projectId)) throw new Error("Reference voice must belong to the same project.");
      if (!["audio/mpeg", "audio/wav"].includes(voice.mime) || !within(voice.duration, 1, 10)) throw new Error("Reference voice must be WAV or MP3 from 1 to 10 seconds.");
      if (exceeds(voice, 15 * mib)) throw new Error("Reference voice must be 15 MB or smaller.");
    }
  }
  if (model.family !== "wan3") return;
  const videos = media.filter(({ input }) => input.role === "reference-video").map(({ asset }) => asset).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  const audio = media.filter(({ input }) => input.role === "reference-audio").map(({ asset }) => asset).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  const totalDuration = (assets: typeof videos, label: string) => {
    if (assets.some((asset) => asset.duration === null || asset.duration === undefined || !Number.isFinite(asset.duration))) throw new Error(`${label} requires measured durations.`);
    return assets.reduce((sum, asset) => sum + Number(asset.duration), 0);
  };
  const videoSeconds = totalDuration(videos, "Reference video validation");
  const audioSeconds = totalDuration(audio, "Reference audio validation");
  if (videoSeconds > 15) throw new Error("Total reference video duration must not exceed 15 seconds.");
  if (audioSeconds > 15) throw new Error("Total reference audio duration must not exceed 15 seconds.");
  if (typeof options.duration === "number" && options.duration !== -1 && videoSeconds + options.duration > 30) throw new Error("Input video and output duration must total 30 seconds or less.");
}

export function queueGeneration(store: ReturnType<typeof createStore>, draft: GenerationDraft, eligibleModels: Set<string>) {
  const request = preflightGeneration(store, draft, eligibleModels);
  return store.createJob({ projectId: request.projectId, idempotencyKey: request.idempotencyKey, modelId: request.model.id, task: request.task, prompt: request.prompt, inputAssetIds: request.media.map((input) => input.assetId), options: { ...request.options, media: request.media, ...(request.internalProvenance ? { internalProvenance: request.internalProvenance } : {}) } });
}
