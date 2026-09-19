export type GenerationTask = "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video" | "reference-to-video";
export type InputRole = "source-image" | "first-frame" | "last-frame" | "reference-image";

export type ModelCapability = {
  id: string;
  label: string;
  task: GenerationTask[];
  providerModel: string;
  media: "image" | "video";
  inputRoles: InputRole[];
  defaultOptions: Record<string, string | number | boolean>;
  quotaRequired: boolean;
  status: "available" | "requires-confirmation";
};

const MODELS: ModelCapability[] = [
  { id: "alibaba:wan2.7-image", label: "Wan 2.7 Image", providerModel: "wan2.7-image", media: "image", task: ["text-to-image", "image-to-image"], inputRoles: ["source-image"], defaultOptions: { size: "1024*1024", n: 1 }, quotaRequired: true, status: "requires-confirmation" },
  { id: "alibaba:wan2.7-i2v", label: "Wan 2.7 I2V", providerModel: "wan2.7-i2v-2026-04-25", media: "video", task: ["image-to-video"], inputRoles: ["first-frame"], defaultOptions: { duration: 5, resolution: "720P", promptExtend: true, watermark: false }, quotaRequired: true, status: "requires-confirmation" },
  { id: "alibaba:wan2.7-r2v", label: "Wan 2.7 Reference Video", providerModel: "wan2.7-r2v-2026-06-12", media: "video", task: ["reference-to-video"], inputRoles: ["reference-image"], defaultOptions: { duration: 5, resolution: "720P" }, quotaRequired: true, status: "requires-confirmation" },
  { id: "alibaba:wan3-video", label: "Wan 3 Video", providerModel: "wan3.0-video", media: "video", task: ["text-to-video", "image-to-video"], inputRoles: ["first-frame", "last-frame"], defaultOptions: { duration: 5, resolution: "720P" }, quotaRequired: true, status: "requires-confirmation" },
  { id: "alibaba:wan3-video-prime", label: "Wan 3 Video Prime", providerModel: "wan3.0-video-prime", media: "video", task: ["text-to-video", "image-to-video"], inputRoles: ["first-frame", "last-frame"], defaultOptions: { duration: 5, resolution: "720P" }, quotaRequired: true, status: "requires-confirmation" },
];

export function listModels() { return MODELS; }
export function getModel(id: string) {
  const model = MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error("Unknown model");
  return model;
}

export function compileCinemaPrompt(prompt: string, controls: { motion?: string; lighting?: string; framing?: string }) {
  const labels: Record<string, string> = { "slow-push-in": "slow push-in", "gentle-pan": "gentle lateral pan", locked: "locked camera", ambient: "subtle ambient motion", reveal: "product reveal" };
  const additions = [controls.motion && labels[controls.motion], controls.lighting, controls.framing].filter(Boolean).join(", ");
  return [prompt.trim(), additions].filter(Boolean).join(". ").slice(0, 5000);
}

export function validateGeneration(model: ModelCapability, request: { task: GenerationTask; prompt: string; inputRoles: InputRole[]; options: Record<string, unknown>; freeQuotaConfirmed?: boolean }) {
  if (!model.task.includes(request.task)) throw new Error(`${model.label} does not support this task.`);
  if (!request.prompt.trim()) throw new Error("A prompt is required.");
  if (request.prompt.length > 5000) throw new Error("Prompt exceeds the 5,000 character provider limit.");
  for (const role of request.inputRoles) {
    if (!model.inputRoles.includes(role)) {
      const display = role.replace("-", " ");
      throw new Error(`${model.label} does not accept a ${display}.`);
    }
  }
  if (request.task === "image-to-video" && request.inputRoles.length === 0) throw new Error("A first frame is required.");
  if (model.quotaRequired && !request.freeQuotaConfirmed) throw new Error("Free quota must be confirmed for this model before submission.");
  const duration = request.options.duration;
  if (duration !== undefined && (!Number.isInteger(duration) || Number(duration) < 2 || Number(duration) > 15)) throw new Error("Video duration must be an integer from 2 to 15 seconds.");
}
