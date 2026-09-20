import { getModel, normalizeMediaRole, type GenerationOptions } from "../models";
import type { ResolvedProviderMedia } from "../media-transport/resolve";

export type SerializedAlibabaRequest = { path: string; async: boolean; timeoutMs: number; body: Record<string, unknown>; requiresOssResourceResolve: boolean };

const providerOptionNames = ["duration", "resolution", "aspectRatio", "promptExtend", "watermark", "audio", "negativePrompt", "size", "n"] as const;
const effectiveOptions = (modelId: string, rawOptions: string) => {
  const parsed = JSON.parse(rawOptions) as Record<string, unknown>;
  const providerOptions = Object.fromEntries(providerOptionNames.filter((name) => parsed[name] !== undefined).map((name) => [name, parsed[name]])) as GenerationOptions;
  return { ...getModel(modelId).defaultOptions, ...providerOptions };
};
const videoInput = (prompt: string, inputs: ResolvedProviderMedia[], roles: Record<string, string>, negativePrompt?: string, includeReferenceVoice = false) => ({
  prompt,
  ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
  media: inputs.map((input) => ({
    type: roles[normalizeMediaRole(input.role)],
    url: input.locator.value,
    ...(includeReferenceVoice && input.referenceVoice ? { reference_voice: input.referenceVoice.value } : {}),
  })),
});
const requiresOssResourceResolve = (inputs: ResolvedProviderMedia[]) => inputs.some((input) => input.locator.kind === "dashscope-oss" || input.referenceVoice?.kind === "dashscope-oss");

export function serializeWanImageRequest(job: { modelId: string; prompt: string; options: string }, inputs: ResolvedProviderMedia[]): SerializedAlibabaRequest {
  const model = getModel(job.modelId); const options = effectiveOptions(job.modelId, job.options);
  const content: Array<Record<string, string>> = [{ text: job.prompt }];
  for (const input of inputs) content.push({ image: input.locator.value });
  return { path: "/services/aigc/multimodal-generation/generation", async: false, timeoutMs: 120_000, requiresOssResourceResolve: requiresOssResourceResolve(inputs), body: { model: model.providerModel, input: { messages: [{ role: "user", content }] }, parameters: options } };
}

export function serializeWan27I2VRequest(job: { modelId: string; prompt: string; options: string }, inputs: ResolvedProviderMedia[]): SerializedAlibabaRequest {
  const model = getModel(job.modelId); const options = effectiveOptions(job.modelId, job.options);
  return { path: "/services/aigc/video-generation/video-synthesis", async: true, timeoutMs: 60_000, requiresOssResourceResolve: requiresOssResourceResolve(inputs), body: { model: model.providerModel, input: videoInput(job.prompt, inputs, { "start-image": "first_frame", "end-image": "last_frame", "driving-audio": "driving_audio", "first-clip": "first_clip" }, options.negativePrompt), parameters: { resolution: options.resolution, duration: options.duration, prompt_extend: options.promptExtend, watermark: options.watermark } } };
}

export function serializeWan27R2VRequest(job: { modelId: string; prompt: string; options: string }, inputs: ResolvedProviderMedia[]): SerializedAlibabaRequest {
  const model = getModel(job.modelId); const options = effectiveOptions(job.modelId, job.options);
  const hasFirstFrame = inputs.some((input) => input.role === "start-image");
  return { path: "/services/aigc/video-generation/video-synthesis", async: true, timeoutMs: 60_000, requiresOssResourceResolve: requiresOssResourceResolve(inputs), body: { model: model.providerModel, input: videoInput(job.prompt, inputs, { "start-image": "first_frame", "reference-image": "reference_image", "reference-video": "reference_video" }, options.negativePrompt, true), parameters: { resolution: options.resolution, duration: options.duration, ...(!hasFirstFrame && options.aspectRatio ? { ratio: options.aspectRatio } : {}), prompt_extend: options.promptExtend, watermark: options.watermark } } };
}

export function serializeWan3Request(job: { modelId: string; prompt: string; options: string }, inputs: ResolvedProviderMedia[]): SerializedAlibabaRequest {
  const model = getModel(job.modelId); const options = effectiveOptions(job.modelId, job.options);
  return { path: "/services/aigc/video-generation/video-synthesis", async: true, timeoutMs: 60_000, requiresOssResourceResolve: requiresOssResourceResolve(inputs), body: { model: model.providerModel, input: videoInput(job.prompt, inputs, { "start-image": "first_frame", "end-image": "last_frame", "reference-image": "reference_image", "reference-video": "reference_video", "reference-audio": "reference_audio" }, options.negativePrompt), parameters: { resolution: options.resolution, duration: options.duration, ...(options.aspectRatio ? { ratio: options.aspectRatio } : {}), prompt_extend: options.promptExtend, watermark: options.watermark, ...(typeof options.audio === "boolean" ? { audio: options.audio } : {}) } } };
}

export function serializeAlibabaJob(job: { modelId: string; prompt: string; options: string }, inputs: ResolvedProviderMedia[]) {
  const model = getModel(job.modelId);
  if (model.family === "wan-image") return serializeWanImageRequest(job, inputs);
  if (model.family === "wan2.7-i2v") return serializeWan27I2VRequest(job, inputs);
  if (model.family === "wan2.7-r2v") return serializeWan27R2VRequest(job, inputs);
  return serializeWan3Request(job, inputs);
}
