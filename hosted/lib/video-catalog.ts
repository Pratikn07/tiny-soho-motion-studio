import { z } from "zod";

import { StudioError } from "@/lib/errors";

export type VideoTask =
  | "text-to-video"
  | "image-to-video"
  | "keyframe-to-video"
  | "reference-to-video"
  | "video-edit"
  | "animate-move"
  | "animate-mix";

export type MediaRole =
  | "first_frame"
  | "last_frame"
  | "reference_image"
  | "reference_video"
  | "source_video"
  | "driving_video"
  | "driving_audio"
  | "first_clip";

export type GenerationMedia = {
  assetId: string;
  role: MediaRole;
  ordinal?: number;
};

const standardOptions = z.object({
  duration: z.number().int().min(2).max(30).optional(),
  resolution: z.enum(["480P", "720P", "1080P"]).optional(),
  aspectRatio: z.enum(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).optional(),
  promptExtend: z.boolean().optional(),
  watermark: z.boolean().optional(),
  audio: z.boolean().optional(),
  mode: z.enum(["wan-std", "wan-pro"]).optional(),
}).strict();

export type VideoOptions = z.infer<typeof standardOptions>;

export type VideoModelContract = Readonly<{
  id: string;
  label: string;
  providerModel: string;
  task: VideoTask;
  contractVersion: string;
  requiredRoles: readonly MediaRole[];
  optionalRoles: readonly MediaRole[];
  maxByRole: Partial<Record<MediaRole, number>>;
  requiresAnyRole?: readonly MediaRole[];
  defaultOptions: VideoOptions;
  optionSchema: typeof standardOptions;
}>;

const CATALOGUE_VERSION = "2026-09-20";
const videoOptions = (defaults: VideoOptions) => ({
  defaultOptions: defaults,
  optionSchema: standardOptions,
  contractVersion: CATALOGUE_VERSION,
} as const);

const textVideo = (id: string, label: string): VideoModelContract => ({
  id,
  label,
  providerModel: id,
  task: "text-to-video",
  requiredRoles: [],
  optionalRoles: [],
  maxByRole: {},
  ...videoOptions({ duration: 5, resolution: "720P", aspectRatio: "16:9", promptExtend: true, watermark: false }),
});

const imageVideo = (id: string, label: string, extended = false): VideoModelContract => ({
  id,
  label,
  providerModel: id,
  task: "image-to-video",
  requiredRoles: ["first_frame"],
  optionalRoles: extended ? ["last_frame", "driving_audio", "first_clip"] : [],
  maxByRole: extended
    ? { first_frame: 1, last_frame: 1, driving_audio: 1, first_clip: 1 }
    : { first_frame: 1 },
  ...videoOptions({ duration: 5, resolution: "720P", promptExtend: true, watermark: false }),
});

const wan3 = (
  providerModel: "wan3.0-video" | "wan3.0-video-prime",
  task: "text-to-video" | "image-to-video" | "reference-to-video",
): VideoModelContract => ({
  id: `${providerModel}:${task}`,
  label: `${providerModel === "wan3.0-video-prime" ? "Wan 3 Video Prime" : "Wan 3 Video"} ${task.replaceAll("-", " ")}`,
  providerModel,
  task,
  requiredRoles: task === "image-to-video" ? ["first_frame"] : [],
  optionalRoles: task === "text-to-video" ? [] : ["last_frame", "reference_image", "reference_video", "driving_audio"],
  requiresAnyRole: task === "reference-to-video" ? ["reference_image", "reference_video"] : undefined,
  maxByRole: { first_frame: 1, last_frame: 1, reference_image: 10, reference_video: 5, driving_audio: 1 },
  ...videoOptions({ duration: 5, resolution: "720P", aspectRatio: "adaptive", promptExtend: true, watermark: false, audio: false }),
});

export const SINGAPORE_VIDEO_MODELS: readonly VideoModelContract[] = [
  textVideo("wan2.7-t2v-2026-04-25", "Wan 2.7 Text to Video"),
  textVideo("wan2.7-t2v-2026-06-12", "Wan 2.7 Text to Video (June 2026 snapshot)"),
  textVideo("wan2.7-t2v", "Wan 2.7 Text to Video"),
  textVideo("wan2.6-t2v", "Wan 2.6 Text to Video"),
  textVideo("wan2.5-t2v-preview", "Wan 2.5 Text to Video Preview"),
  textVideo("wan2.2-t2v-plus", "Wan 2.2 Text to Video Plus"),
  textVideo("wan2.1-t2v-turbo", "Wan 2.1 Text to Video Turbo"),
  textVideo("wan2.1-t2v-plus", "Wan 2.1 Text to Video Plus"),
  imageVideo("wan2.7-i2v-2026-04-25", "Wan 2.7 Image to Video", true),
  imageVideo("wan2.7-i2v", "Wan 2.7 Image to Video", true),
  imageVideo("wan2.6-i2v-flash", "Wan 2.6 Image to Video Flash"),
  imageVideo("wan2.6-i2v", "Wan 2.6 Image to Video"),
  imageVideo("wan2.5-i2v-preview", "Wan 2.5 Image to Video Preview"),
  imageVideo("wan2.2-i2v-flash", "Wan 2.2 Image to Video Flash"),
  imageVideo("wan2.2-i2v-plus", "Wan 2.2 Image to Video Plus"),
  imageVideo("wan2.1-i2v-plus", "Wan 2.1 Image to Video Plus"),
  imageVideo("wan2.1-i2v-turbo", "Wan 2.1 Image to Video Turbo"),
  wan3("wan3.0-video", "text-to-video"),
  wan3("wan3.0-video", "image-to-video"),
  wan3("wan3.0-video", "reference-to-video"),
  wan3("wan3.0-video-prime", "text-to-video"),
  wan3("wan3.0-video-prime", "image-to-video"),
  wan3("wan3.0-video-prime", "reference-to-video"),
  {
    id: "wan2.2-kf2v-flash",
    label: "Wan 2.2 Keyframe to Video Flash",
    providerModel: "wan2.2-kf2v-flash",
    task: "keyframe-to-video",
    requiredRoles: ["first_frame", "last_frame"],
    optionalRoles: [],
    maxByRole: { first_frame: 1, last_frame: 1 },
    ...videoOptions({ duration: 5, resolution: "720P", promptExtend: true, watermark: false }),
  },
  {
    id: "wan2.1-kf2v-plus",
    label: "Wan 2.1 Keyframe to Video Plus",
    providerModel: "wan2.1-kf2v-plus",
    task: "keyframe-to-video",
    requiredRoles: ["first_frame", "last_frame"],
    optionalRoles: [],
    maxByRole: { first_frame: 1, last_frame: 1 },
    ...videoOptions({ duration: 5, resolution: "720P", promptExtend: true, watermark: false }),
  },
  ...[
    ["wan2.7-r2v", "Wan 2.7 Reference to Video"],
    ["wan2.7-r2v-2026-06-12", "Wan 2.7 Reference to Video (June 2026 snapshot)"],
    ["wan2.6-r2v-flash", "Wan 2.6 Reference to Video Flash"],
    ["wan2.6-r2v", "Wan 2.6 Reference to Video"],
  ].map(([id, label]): VideoModelContract => ({
    id,
    label,
    providerModel: id,
    task: "reference-to-video",
    requiredRoles: [],
    optionalRoles: ["first_frame", "reference_image", "reference_video"],
    requiresAnyRole: ["reference_image", "reference_video"],
    maxByRole: { first_frame: 1, reference_image: 10, reference_video: 5 },
    ...videoOptions({ duration: 5, resolution: "720P", aspectRatio: "16:9", promptExtend: true, watermark: false }),
  })),
  ...[
    ["wan2.7-videoedit", "Wan 2.7 Video Edit"],
    ["wan2.1-vace-plus", "Wan 2.1 VACE Plus"],
  ].map(([id, label]): VideoModelContract => ({
    id,
    label,
    providerModel: id,
    task: "video-edit",
    requiredRoles: ["source_video"],
    optionalRoles: ["reference_image", "reference_video"],
    maxByRole: { source_video: 1, reference_image: 10, reference_video: 5 },
    ...videoOptions({ duration: 5, resolution: "720P", promptExtend: true, watermark: false }),
  })),
  ...[
    ["wan2.2-animate-move", "Wan 2.2 Animate Move", "animate-move"],
    ["wan2.2-animate-mix", "Wan 2.2 Animate Mix", "animate-mix"],
  ].map(([id, label, task]): VideoModelContract => ({
    id,
    label,
    providerModel: id,
    task: task as VideoTask,
    requiredRoles: ["first_frame", "driving_video"],
    optionalRoles: ["reference_image"],
    maxByRole: { first_frame: 1, driving_video: 1, reference_image: 1 },
    ...videoOptions({ duration: 5, resolution: "720P", mode: "wan-std", promptExtend: true, watermark: false }),
  })),
];

export type ModelAcknowledgement = {
  modelId: string;
  contractVersion: string;
};

export type PreparedVideoGeneration = {
  contract: VideoModelContract;
  prompt: string;
  media: Array<GenerationMedia & { ordinal: number }>;
  options: VideoOptions;
};

export function getVideoModelContract(modelId: string): VideoModelContract | null {
  return SINGAPORE_VIDEO_MODELS.find((model) => model.id === modelId) ?? null;
}

const invalid = (code: string, message: string): never => {
  throw new StudioError(400, code, message);
};

const rolePriority: Record<MediaRole, number> = {
  first_frame: 1,
  first_clip: 2,
  last_frame: 3,
  source_video: 4,
  driving_video: 5,
  driving_audio: 6,
  reference_image: 7,
  reference_video: 8,
};

export function preflightVideoGeneration(input: {
  modelId: string;
  prompt: string;
  media: GenerationMedia[];
  options: unknown;
  acknowledgements: readonly ModelAcknowledgement[];
}): PreparedVideoGeneration {
  const contract = getVideoModelContract(input.modelId);
  if (!contract) {
    throw new StudioError(400, "unsupported_model", "Choose a Singapore video model from the Studio catalogue.");
  }
  if (!input.acknowledgements.some((acknowledgement) => acknowledgement.modelId === contract.id && acknowledgement.contractVersion === contract.contractVersion)) {
    invalid("billing_acknowledgement_required", "Acknowledge this model's Alibaba billing and quota terms before generating.");
  }

  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 5000) invalid("invalid_prompt", "Enter a prompt from 1 to 5,000 characters.");

  const roles = input.media.map((media) => media.role);
  const allowedRoles = new Set([...contract.requiredRoles, ...contract.optionalRoles]);
  if (roles.some((role) => !allowedRoles.has(role))) invalid("invalid_media_role", `${contract.label} does not accept this media input.`);
  for (const role of contract.requiredRoles) {
    if (!roles.includes(role)) invalid("required_media_missing", `${contract.label} requires ${role.replaceAll("_", " ")}.`);
  }
  if (contract.requiresAnyRole && !contract.requiresAnyRole.some((role) => roles.includes(role))) {
    invalid("reference_media_required", `${contract.label} requires a reference image or reference video.`);
  }
  for (const [role, maximum] of Object.entries(contract.maxByRole) as Array<[MediaRole, number]>) {
    if (roles.filter((candidate) => candidate === role).length > maximum) {
      invalid("too_many_media", `${contract.label} accepts at most ${maximum} ${role.replaceAll("_", " ")} input${maximum === 1 ? "" : "s"}.`);
    }
  }
  const media = input.media.map((item, index) => ({ ...item, ordinal: item.ordinal ?? index + 1 }));
  if (media.some((item, index) => index > 0 && item.ordinal <= media[index - 1].ordinal)) {
    invalid("invalid_media_order", "Media inputs must have a stable ascending order.");
  }
  if (media.some((item, index) => index > 0 && rolePriority[item.role] < rolePriority[media[index - 1].role])) {
    invalid("invalid_media_role_order", "Media inputs are not in the model's supported order.");
  }
  const parsed = contract.optionSchema.safeParse(input.options);
  if (!parsed.success) invalid("invalid_options", "Choose options supported by this video model.");
  return { contract, prompt, media, options: { ...contract.defaultOptions, ...parsed.data } };
}
