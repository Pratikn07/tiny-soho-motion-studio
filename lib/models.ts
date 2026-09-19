export type GenerationTask = "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video" | "reference-to-video";
export type MediaRole = "source-image" | "start-image" | "end-image" | "reference-image" | "reference-video" | "reference-audio";
export type InputRole = MediaRole | "first-frame" | "last-frame";

export type GenerationOptions = { duration?: number; resolution?: string; aspectRatio?: string; promptExtend?: boolean; watermark?: boolean; audio?: boolean; negativePrompt?: string; size?: string; n?: number };

export type ModelCapability = {
  id: string; label: string; providerModel: string; family: "wan-image" | "wan2.7-i2v" | "wan2.7-r2v" | "wan3"; media: "image" | "video";
  tasks: GenerationTask[]; task: GenerationTask[];
  mediaRules: { allowedRoles: MediaRole[]; maxByRole: Partial<Record<MediaRole, number>>; combinations: MediaRole[][] };
  duration?: { min: number; max: number; smartValue?: -1; maxWhenRolePresent?: Partial<Record<MediaRole, number>> };
  resolutions?: string[]; aspectRatios?: string[]; defaultOptions: GenerationOptions; quotaRequired: boolean; status: "available" | "requires-confirmation";
};

const withTasks = (model: Omit<ModelCapability, "task">): ModelCapability => ({ ...model, task: model.tasks });
const videoRoles: MediaRole[] = ["start-image", "end-image", "reference-image", "reference-video", "reference-audio"];
const videoCombinations: MediaRole[][] = [[], ["start-image"], ["start-image", "end-image"], ["reference-image"], ["reference-video"], ["reference-audio"]];
const videoLimits: Partial<Record<MediaRole, number>> = { "start-image": 1, "end-image": 1, "reference-image": 20, "reference-video": 20, "reference-audio": 20 };
const wan3Ratios = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const MODELS: ModelCapability[] = [
  withTasks({ id: "alibaba:wan2.7-image", label: "Wan 2.7 Image", providerModel: "wan2.7-image", family: "wan-image", media: "image", tasks: ["text-to-image", "image-to-image"], mediaRules: { allowedRoles: ["source-image"], maxByRole: { "source-image": 1 }, combinations: [[], ["source-image"]] }, defaultOptions: { size: "1024*1024", n: 1 }, quotaRequired: true, status: "requires-confirmation" }),
  withTasks({ id: "alibaba:wan2.7-i2v", label: "Wan 2.7 I2V", providerModel: "wan2.7-i2v-2026-04-25", family: "wan2.7-i2v", media: "video", tasks: ["image-to-video"], mediaRules: { allowedRoles: ["start-image", "end-image"], maxByRole: { "start-image": 1, "end-image": 1 }, combinations: [["start-image"], ["start-image", "end-image"]] }, duration: { min: 2, max: 15 }, resolutions: ["720P", "1080P"], defaultOptions: { duration: 5, resolution: "720P", promptExtend: true, watermark: false }, quotaRequired: true, status: "requires-confirmation" }),
  withTasks({ id: "alibaba:wan2.7-r2v", label: "Wan 2.7 Reference Video", providerModel: "wan2.7-r2v-2026-06-12", family: "wan2.7-r2v", media: "video", tasks: ["reference-to-video"], mediaRules: { allowedRoles: ["reference-image", "reference-video", "reference-audio"], maxByRole: { "reference-image": 1, "reference-video": 1, "reference-audio": 1 }, combinations: [["reference-image"], ["reference-video"], ["reference-audio"]] }, duration: { min: 2, max: 15, maxWhenRolePresent: { "reference-video": 10 } }, resolutions: ["720P", "1080P"], aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"], defaultOptions: { duration: 5, resolution: "720P", aspectRatio: "16:9", promptExtend: true, watermark: false }, quotaRequired: true, status: "requires-confirmation" }),
  withTasks({ id: "alibaba:wan3-video", label: "Wan 3 Video", providerModel: "wan3.0-video", family: "wan3", media: "video", tasks: ["text-to-video", "image-to-video", "reference-to-video"], mediaRules: { allowedRoles: videoRoles, maxByRole: videoLimits, combinations: videoCombinations }, duration: { min: 2, max: 30, smartValue: -1 }, resolutions: ["480P", "720P", "1080P"], aspectRatios: wan3Ratios, defaultOptions: { duration: 5, resolution: "720P", aspectRatio: "adaptive", promptExtend: true, watermark: false, audio: false }, quotaRequired: true, status: "requires-confirmation" }),
  withTasks({ id: "alibaba:wan3-video-prime", label: "Wan 3 Video Prime", providerModel: "wan3.0-video-prime", family: "wan3", media: "video", tasks: ["text-to-video", "image-to-video", "reference-to-video"], mediaRules: { allowedRoles: videoRoles, maxByRole: videoLimits, combinations: videoCombinations }, duration: { min: 2, max: 30, smartValue: -1 }, resolutions: ["480P", "720P", "1080P"], aspectRatios: wan3Ratios, defaultOptions: { duration: 5, resolution: "720P", aspectRatio: "adaptive", promptExtend: true, watermark: false, audio: false }, quotaRequired: true, status: "requires-confirmation" }),
];
const ROLE_ALIASES: Record<InputRole, MediaRole> = { "source-image": "source-image", "start-image": "start-image", "end-image": "end-image", "reference-image": "reference-image", "reference-video": "reference-video", "reference-audio": "reference-audio", "first-frame": "start-image", "last-frame": "end-image" };

export function normalizeMediaRole(role: string): MediaRole { const normalized = ROLE_ALIASES[role as InputRole]; if (!normalized) throw new Error(`Unknown media role: ${role}.`); return normalized; }
export function listModels() { return MODELS; }
export function getModel(id: string) { const model = MODELS.find((candidate) => candidate.id === id); if (!model) throw new Error("Unknown model."); return model; }
export function compileCinemaPrompt(prompt: string, controls: { motion?: string; lighting?: string; framing?: string }) { const labels: Record<string, string> = { "slow-push-in": "slow push-in", "gentle-pan": "gentle lateral pan", locked: "locked camera", ambient: "subtle ambient motion", reveal: "product reveal" }; const additions = [controls.motion && labels[controls.motion], controls.lighting, controls.framing].filter(Boolean).join(", "); return [prompt.trim(), additions].filter(Boolean).join(". ").slice(0, 5000); }
const equalRoles = (left: MediaRole[], right: MediaRole[]) => left.length === right.length && [...left].sort().every((role, index) => role === [...right].sort()[index]);

export function validateGeneration(model: ModelCapability, request: { task: GenerationTask; prompt: string; inputRoles: InputRole[]; options: Record<string, unknown>; freeQuotaConfirmed?: boolean }) {
  const roles = request.inputRoles.map(normalizeMediaRole);
  if (!model.tasks.includes(request.task)) throw new Error(`${model.label} does not support this task.`);
  if (!request.prompt.trim()) throw new Error("A prompt is required.");
  if (request.prompt.length > 5000) throw new Error("Prompt exceeds the 5,000 character provider limit.");
  if (typeof request.options.negativePrompt === "string" && request.options.negativePrompt.length > 500) throw new Error("Negative prompt exceeds the 500 character provider limit.");
  for (const role of roles) if (!model.mediaRules.allowedRoles.includes(role)) throw new Error(`${model.label} does not accept a ${role.replace("-", " ")}.`);
  for (const [role, maximum] of Object.entries(model.mediaRules.maxByRole) as [MediaRole, number][]) if (roles.filter((candidate) => candidate === role).length > maximum) throw new Error(`${model.label} accepts at most ${maximum} ${role.replace("-", " ")} input.`);
  if (request.task === "image-to-video" && !roles.includes("start-image")) throw new Error("A start image is required.");
  if (request.task === "reference-to-video" && !roles.some((role) => role.startsWith("reference-"))) throw new Error("A reference input is required.");
  if (!model.mediaRules.combinations.some((combination) => equalRoles(combination, roles))) throw new Error(`${model.label} does not support this media combination.`);
  if (model.quotaRequired && !request.freeQuotaConfirmed) throw new Error("Free quota must be confirmed for this model before submission.");
  if (model.duration) { const duration = request.options.duration ?? model.defaultOptions.duration; const max = roles.reduce((value, role) => Math.min(value, model.duration?.maxWhenRolePresent?.[role] ?? value), model.duration.max); if (duration !== model.duration.smartValue && (!Number.isInteger(duration) || Number(duration) < model.duration.min || Number(duration) > max)) throw new Error(`Video duration must be an integer from ${model.duration.min} to ${max} seconds${model.duration.smartValue ? ` or ${model.duration.smartValue} for smart duration` : ""}.`); }
  if (model.resolutions && request.options.resolution !== undefined && !model.resolutions.includes(String(request.options.resolution))) throw new Error(`${model.label} does not support ${request.options.resolution} resolution.`);
  if (model.aspectRatios && request.options.aspectRatio !== undefined && !model.aspectRatios.includes(String(request.options.aspectRatio))) throw new Error(`${model.label} does not support ${request.options.aspectRatio} aspect ratio.`);
  if (!model.aspectRatios && request.options.aspectRatio !== undefined) throw new Error(`${model.label} derives its aspect ratio from the input media.`);
}
