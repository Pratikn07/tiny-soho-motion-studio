import { getModel, normalizeMediaRole, validateGeneration, type GenerationOptions, type GenerationTask, type MediaRole, type ModelCapability } from "./models";
import type { createStore } from "./store";

export type GenerationMedia = { assetId: string; role: MediaRole };
export type GenerationDraft = {
  projectId: string;
  idempotencyKey: string;
  modelId: string;
  prompt: string;
  media?: Array<{ assetId: string; role: string }>;
  // Compatibility with jobs stored before the normalized media contract.
  inputAssetIds?: string[];
  inputRoles?: string[];
  options?: Record<string, unknown>;
  internalProvenance?: Record<string, unknown>;
};
export type ValidatedGenerationRequest = { projectId: string; idempotencyKey: string; model: ModelCapability; task: GenerationTask; prompt: string; media: GenerationMedia[]; options: GenerationOptions; internalProvenance: Record<string, unknown> | undefined };

const optionNames = new Set(["duration", "resolution", "aspectRatio", "ratio", "promptExtend", "watermark", "audio", "negativePrompt", "size", "n"]);
const mimeForRole: Record<MediaRole, string> = { "source-image": "image/", "start-image": "image/", "end-image": "image/", "reference-image": "image/", "reference-video": "video/", "reference-audio": "audio/" };

export function normalizeGenerationDraft(draft: GenerationDraft) {
  if (!draft.projectId?.trim()) throw new Error("A project is required.");
  if (!draft.idempotencyKey?.trim()) throw new Error("An idempotency key is required.");
  if (!draft.modelId?.trim()) throw new Error("A model is required.");
  if (typeof draft.prompt !== "string") throw new Error("A prompt is required.");
  const mediaSource = draft.media ?? (() => {
    const assets = draft.inputAssetIds || []; const roles = draft.inputRoles || [];
    if (assets.length !== roles.length) throw new Error("Every input asset needs a media role.");
    return assets.map((assetId, index) => ({ assetId, role: roles[index] }));
  })();
  if (!Array.isArray(mediaSource)) throw new Error("Media must be a list.");
  const media = mediaSource.map((item) => {
    if (!item || typeof item.assetId !== "string" || !item.assetId.trim() || typeof item.role !== "string") throw new Error("Each media input needs an asset and role.");
    return { assetId: item.assetId, role: normalizeMediaRole(item.role) };
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
  for (const input of normalized.media) {
    const asset = store.getAsset(input.assetId);
    if (!asset) throw new Error(`Referenced asset ${input.assetId} was not found.`);
    if (asset.projectId && asset.projectId !== project.id) throw new Error("Referenced assets must belong to the same project.");
    if (!asset.mime.startsWith(mimeForRole[input.role])) throw new Error(`${input.role.replace("-", " ")} requires a ${mimeForRole[input.role].slice(0, -1)} asset.`);
  }
  const task = inferTask(model, normalized.media);
  const options = { ...model.defaultOptions, ...normalized.options };
  validateGeneration(model, { task, prompt: normalized.prompt, inputRoles: normalized.media.map((input) => input.role), options, freeQuotaConfirmed: eligibleModels.has(model.id) });
  return { projectId: normalized.projectId, idempotencyKey: normalized.idempotencyKey, model, task, prompt: normalized.prompt, media: normalized.media, options, internalProvenance: normalized.internalProvenance };
}

export function queueGeneration(store: ReturnType<typeof createStore>, draft: GenerationDraft, eligibleModels: Set<string>) {
  const request = preflightGeneration(store, draft, eligibleModels);
  return store.createJob({ projectId: request.projectId, idempotencyKey: request.idempotencyKey, modelId: request.model.id, task: request.task, prompt: request.prompt, inputAssetIds: request.media.map((input) => input.assetId), options: { ...request.options, media: request.media, ...(request.internalProvenance ? { internalProvenance: request.internalProvenance } : {}) } });
}
