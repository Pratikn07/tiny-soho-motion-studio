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
  | "mask_image"
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
  duration: z.number().int().min(0).max(30).optional(),
  resolution: z.enum(["480P", "720P", "1080P"]).optional(),
  aspectRatio: z.enum(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).optional(),
  promptExtend: z.boolean().optional(),
  watermark: z.boolean().optional(),
  shotType: z.enum(["single", "multi"]).optional(),
  audio: z.boolean().optional(),
  audioSetting: z.enum(["auto", "origin"]).optional(),
  mode: z.enum(["wan-std", "wan-pro"]).optional(),
  operation: z.enum(["image_reference", "video_repainting", "video_edit", "video_extension", "video_outpainting"]).optional(),
  maskFrameId: z.number().int().min(0).optional(),
  maskType: z.enum(["tracking", "manual"]).optional(),
  expandRatio: z.number().min(0).max(1).optional(),
  topScale: z.number().min(1).max(2).optional(),
  bottomScale: z.number().min(1).max(2).optional(),
  leftScale: z.number().min(1).max(2).optional(),
  rightScale: z.number().min(1).max(2).optional(),
}).strict();

export type VideoOptions = z.infer<typeof standardOptions>;

export type VideoModelContract = Readonly<{
  id: string;
  label: string;
  providerModel: string;
  task: VideoTask;
  contractVersion: string;
  promptRequired: boolean;
  requiredRoles: readonly MediaRole[];
  optionalRoles: readonly MediaRole[];
  maxByRole: Partial<Record<MediaRole, number>>;
  maxAcrossRoles?: readonly Readonly<{ roles: readonly MediaRole[]; max: number }>[];
  prohibitedRoleCombinations?: readonly (readonly MediaRole[])[];
  requiresAnyRole?: readonly MediaRole[];
  promptMax: number;
  duration?: Readonly<{ min: number; max: number; values?: readonly number[] }>;
  durationMaxByRole?: Partial<Record<MediaRole, number>>;
  resolutions?: readonly ("480P" | "720P" | "1080P")[];
  aspectRatios?: readonly ("adaptive" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16")[];
  optionKeys: readonly (keyof VideoOptions)[];
  requiredOptionKeys?: readonly (keyof VideoOptions)[];
  defaultOptions: VideoOptions;
  optionSchema: typeof standardOptions;
}>;

const CATALOGUE_VERSION = "2026-09-20";
const videoOptions = (defaults: VideoOptions, optionKeys: readonly (keyof VideoOptions)[] = Object.keys(defaults) as Array<keyof VideoOptions>) => ({
  defaultOptions: defaults,
  optionKeys,
  optionSchema: standardOptions,
  contractVersion: CATALOGUE_VERSION,
} as const);

const textVideo = (id: string, label: string): VideoModelContract => ({
  id,
  label,
  providerModel: id,
  task: "text-to-video",
  promptRequired: true,
  promptMax: 5000,
  requiredRoles: [],
  optionalRoles: ["driving_audio"],
  maxByRole: { driving_audio: 1 },
  duration: { min: 2, max: 15 },
  resolutions: ["720P", "1080P"],
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  ...videoOptions({ duration: 5, resolution: "720P", aspectRatio: "16:9", promptExtend: true, watermark: false }),
});

const imageVideo = (id: string, label: string, extended = false): VideoModelContract => ({
  id,
  label,
  providerModel: id,
  task: "image-to-video",
  promptRequired: true,
  promptMax: 5000,
  requiredRoles: extended ? [] : ["first_frame"],
  optionalRoles: extended ? ["first_frame", "last_frame", "driving_audio", "first_clip"] : [],
  requiresAnyRole: extended ? ["first_frame", "first_clip"] : undefined,
  prohibitedRoleCombinations: extended ? [["first_frame", "first_clip"], ["first_clip", "driving_audio"]] : undefined,
  maxByRole: extended
    ? { first_frame: 1, last_frame: 1, driving_audio: 1, first_clip: 1 }
    : { first_frame: 1 },
  duration: { min: 2, max: 15 },
  resolutions: ["720P", "1080P"],
  ...videoOptions({ duration: 5, resolution: "720P", promptExtend: true, watermark: false }),
});

const legacyTextVideo = (input: {
  id: string;
  label: string;
  promptMax: number;
  duration?: VideoModelContract["duration"];
  resolutions: NonNullable<VideoModelContract["resolutions"]>;
  audio?: boolean;
  shotType?: boolean;
}): VideoModelContract => ({
  id: input.id,
  label: input.label,
  providerModel: input.id,
  task: "text-to-video",
  promptRequired: true,
  promptMax: input.promptMax,
  requiredRoles: [],
  optionalRoles: input.audio ? ["driving_audio"] : [],
  maxByRole: input.audio ? { driving_audio: 1 } : {},
  duration: input.duration,
  resolutions: input.resolutions,
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  ...videoOptions({
    ...(input.duration ? { duration: input.duration.values?.includes(5) ? 5 : input.duration.values?.[0] ?? 5 } : {}),
    resolution: input.resolutions.includes("720P") ? "720P" : input.resolutions[0],
    aspectRatio: "16:9",
    promptExtend: true,
    watermark: false,
    ...(input.shotType ? { shotType: "single" as const } : {}),
  }),
});

const legacyImageVideo = (input: {
  id: string;
  label: string;
  promptMax: number;
  duration?: VideoModelContract["duration"];
  resolutions: NonNullable<VideoModelContract["resolutions"]>;
  audio?: boolean;
  audioToggle?: boolean;
  shotType?: boolean;
}): VideoModelContract => ({
  id: input.id,
  label: input.label,
  providerModel: input.id,
  task: "image-to-video",
  promptRequired: true,
  promptMax: input.promptMax,
  requiredRoles: ["first_frame"],
  optionalRoles: input.audio ? ["driving_audio"] : [],
  maxByRole: { first_frame: 1, ...(input.audio ? { driving_audio: 1 } : {}) },
  duration: input.duration,
  resolutions: input.resolutions,
  ...videoOptions({
    ...(input.duration ? { duration: input.duration.values?.includes(5) ? 5 : input.duration.values?.[0] ?? 5 } : {}),
    resolution: input.resolutions.includes("720P") ? "720P" : input.resolutions[0],
    promptExtend: true,
    watermark: false,
    ...(input.audioToggle ? { audio: true } : {}),
    ...(input.shotType ? { shotType: "single" as const } : {}),
  }),
});

const wan3 = (
  providerModel: "wan3.0-video" | "wan3.0-video-prime",
  task: "text-to-video" | "image-to-video" | "reference-to-video",
): VideoModelContract => ({
  id: `${providerModel}:${task}`,
  label: `${providerModel === "wan3.0-video-prime" ? "Wan 3 Video Prime" : "Wan 3 Video"} ${task.replaceAll("-", " ")}`,
  providerModel,
  task,
  promptRequired: true,
  promptMax: 5000,
  requiredRoles: task === "image-to-video" ? ["first_frame"] : [],
  optionalRoles: task === "text-to-video" ? [] : ["last_frame", "reference_image", "reference_video", "driving_audio"],
  requiresAnyRole: task === "reference-to-video" ? ["reference_image", "reference_video"] : undefined,
  maxByRole: { first_frame: 1, last_frame: 1, reference_image: 10, reference_video: 5, driving_audio: 1 },
  duration: { min: 2, max: 30 },
  resolutions: ["480P", "720P", "1080P"],
  aspectRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  ...videoOptions({ duration: 5, resolution: "720P", aspectRatio: "adaptive", promptExtend: true, watermark: false, audio: false }),
});

const vace = (
  id: string,
  label: string,
  requiredRoles: readonly MediaRole[],
  optionalRoles: readonly MediaRole[],
  requiresAnyRole?: readonly MediaRole[],
): VideoModelContract => {
  const localEdit = id === "video_edit";
  const outpainting = id === "video_outpainting";
  return ({
  id: `wan2.1-vace-plus:${id.replaceAll("_", "-")}`,
  label: `Wan 2.1 VACE Plus — ${label}`,
  providerModel: "wan2.1-vace-plus",
  task: "video-edit",
  promptRequired: true,
  promptMax: 5000,
  requiredRoles,
  optionalRoles,
  requiresAnyRole,
  maxByRole: { source_video: 1, first_clip: 1, mask_image: 1, reference_image: 3 },
  requiredOptionKeys: localEdit ? ["maskFrameId"] : undefined,
  ...videoOptions({
    promptExtend: true,
    watermark: false,
    operation: id as NonNullable<VideoOptions["operation"]>,
    ...(localEdit ? { maskType: "tracking" as const, expandRatio: 0 } : {}),
    ...(outpainting ? { topScale: 1, bottomScale: 1, leftScale: 1, rightScale: 1 } : {}),
  }),
  });
};

export const SINGAPORE_VIDEO_MODELS: readonly VideoModelContract[] = [
  textVideo("wan2.7-t2v-2026-04-25", "Wan 2.7 Text to Video (April 2026 snapshot)"),
  textVideo("wan2.7-t2v-2026-06-12", "Wan 2.7 Text to Video (June 2026 snapshot)"),
  textVideo("wan2.7-t2v", "Wan 2.7 Text to Video (current)"),
  legacyTextVideo({ id: "wan2.6-t2v", label: "Wan 2.6 Text to Video", promptMax: 1500, duration: { min: 2, max: 15 }, resolutions: ["720P", "1080P"], audio: true, shotType: true }),
  legacyTextVideo({ id: "wan2.5-t2v-preview", label: "Wan 2.5 Text to Video Preview", promptMax: 1500, duration: { min: 5, max: 10, values: [5, 10] }, resolutions: ["480P", "720P", "1080P"], audio: true }),
  legacyTextVideo({ id: "wan2.2-t2v-plus", label: "Wan 2.2 Text to Video Plus", promptMax: 800, resolutions: ["480P", "1080P"] }),
  legacyTextVideo({ id: "wan2.1-t2v-turbo", label: "Wan 2.1 Text to Video Turbo", promptMax: 800, resolutions: ["480P", "720P"] }),
  legacyTextVideo({ id: "wan2.1-t2v-plus", label: "Wan 2.1 Text to Video Plus", promptMax: 800, resolutions: ["720P"] }),
  imageVideo("wan2.7-i2v-2026-04-25", "Wan 2.7 Image to Video (April 2026 snapshot)", true),
  imageVideo("wan2.7-i2v", "Wan 2.7 Image to Video (current)", true),
  legacyImageVideo({ id: "wan2.6-i2v-flash", label: "Wan 2.6 Image to Video Flash", promptMax: 1500, duration: { min: 2, max: 15 }, resolutions: ["720P", "1080P"], audio: true, audioToggle: true, shotType: true }),
  legacyImageVideo({ id: "wan2.6-i2v", label: "Wan 2.6 Image to Video", promptMax: 1500, duration: { min: 2, max: 15 }, resolutions: ["720P", "1080P"], audio: true, shotType: true }),
  legacyImageVideo({ id: "wan2.5-i2v-preview", label: "Wan 2.5 Image to Video Preview", promptMax: 1500, duration: { min: 5, max: 10, values: [5, 10] }, resolutions: ["480P", "720P", "1080P"], audio: true }),
  legacyImageVideo({ id: "wan2.2-i2v-flash", label: "Wan 2.2 Image to Video Flash", promptMax: 800, resolutions: ["480P", "720P"] }),
  legacyImageVideo({ id: "wan2.2-i2v-plus", label: "Wan 2.2 Image to Video Plus", promptMax: 800, resolutions: ["480P", "1080P"] }),
  legacyImageVideo({ id: "wan2.1-i2v-plus", label: "Wan 2.1 Image to Video Plus", promptMax: 800, resolutions: ["720P"] }),
  legacyImageVideo({ id: "wan2.1-i2v-turbo", label: "Wan 2.1 Image to Video Turbo", promptMax: 800, duration: { min: 3, max: 5, values: [3, 4, 5] }, resolutions: ["480P", "720P"] }),
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
    promptRequired: true,
    promptMax: 800,
    requiredRoles: ["first_frame", "last_frame"],
    optionalRoles: [],
    maxByRole: { first_frame: 1, last_frame: 1 },
    duration: { min: 5, max: 5, values: [5] },
    resolutions: ["480P", "720P", "1080P"],
    ...videoOptions({ resolution: "720P", promptExtend: true, watermark: false }),
  },
  {
    id: "wan2.1-kf2v-plus",
    label: "Wan 2.1 Keyframe to Video Plus",
    providerModel: "wan2.1-kf2v-plus",
    task: "keyframe-to-video",
    promptRequired: true,
    promptMax: 800,
    requiredRoles: ["first_frame", "last_frame"],
    optionalRoles: [],
    maxByRole: { first_frame: 1, last_frame: 1 },
    duration: { min: 5, max: 5, values: [5] },
    resolutions: ["720P"],
    ...videoOptions({ resolution: "720P", promptExtend: true, watermark: false }),
  },
  ...[
    ["wan2.7-r2v", "Wan 2.7 Reference to Video"],
    ["wan2.7-r2v-2026-06-12", "Wan 2.7 Reference to Video (June 2026 snapshot)"],
    ["wan2.6-r2v-flash", "Wan 2.6 Reference to Video Flash"],
    ["wan2.6-r2v", "Wan 2.6 Reference to Video"],
  ].map(([id, label]): VideoModelContract => {
    const wan27 = id.startsWith("wan2.7");
    const flash = id === "wan2.6-r2v-flash";
    return ({
    id,
    label,
    providerModel: id,
    task: "reference-to-video",
    promptRequired: true,
    promptMax: wan27 ? 5000 : 1500,
    requiredRoles: [],
    optionalRoles: [...(wan27 ? ["first_frame" as const] : []), "reference_image", "reference_video", ...(wan27 ? ["driving_audio" as const] : [])],
    requiresAnyRole: ["reference_image", "reference_video"],
    maxByRole: { ...(wan27 ? { first_frame: 1 } : {}), reference_image: 5, reference_video: wan27 ? 5 : 3, ...(wan27 ? { driving_audio: 5 } : {}) },
    maxAcrossRoles: [{ roles: ["reference_image", "reference_video"], max: 5 }],
    duration: { min: 2, max: wan27 ? 15 : 10 },
    durationMaxByRole: wan27 ? { reference_video: 10 } : undefined,
    resolutions: ["720P", "1080P"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    ...videoOptions(
      wan27
        ? { duration: 5, resolution: "720P", aspectRatio: "16:9", promptExtend: true, watermark: false }
        : { duration: 5, resolution: "720P", aspectRatio: "16:9", promptExtend: true, watermark: false, shotType: "single", ...(flash ? { audio: true } : {}) },
    ),
    });
  }),
  ...[
    ["wan2.7-videoedit", "Wan 2.7 Video Edit"],
  ].map(([id, label]): VideoModelContract => ({
    id,
    label,
    providerModel: id,
    task: "video-edit",
    promptRequired: true,
    promptMax: 5000,
    requiredRoles: ["source_video"],
    optionalRoles: ["reference_image", "reference_video"],
    maxByRole: { source_video: 1, reference_image: 4 },
    duration: { min: 2, max: 10 },
    resolutions: ["720P", "1080P"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    ...videoOptions({ resolution: "1080P", audioSetting: "auto", promptExtend: true, watermark: false }, ["duration", "resolution", "aspectRatio", "audioSetting", "promptExtend", "watermark"]),
  })),
  vace("image_reference", "image reference", [], ["reference_image"], ["reference_image"]),
  vace("video_repainting", "video repainting", ["source_video"], []),
  vace("video_edit", "local video edit", ["source_video", "mask_image"], []),
  vace("video_extension", "video extension", ["first_clip"], []),
  vace("video_outpainting", "video outpainting", ["source_video"], []),
  ...[
    ["wan2.2-animate-move", "Wan 2.2 Animate Move", "animate-move"],
    ["wan2.2-animate-mix", "Wan 2.2 Animate Mix", "animate-mix"],
  ].map(([id, label, task]): VideoModelContract => ({
    id,
    label,
    providerModel: id,
    task: task as VideoTask,
    promptRequired: false,
    promptMax: 5000,
    requiredRoles: ["first_frame", "driving_video"],
    optionalRoles: ["reference_image"],
    maxByRole: { first_frame: 1, driving_video: 1, reference_image: 1 },
    ...videoOptions({ mode: "wan-std", watermark: false }),
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
  mask_image: 2,
  first_clip: 3,
  last_frame: 4,
  source_video: 5,
  driving_video: 6,
  driving_audio: 10,
  reference_image: 8,
  reference_video: 9,
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
  if (prompt.length > contract.promptMax || (contract.promptRequired && !prompt)) {
    invalid("invalid_prompt", contract.promptRequired ? `Enter a prompt from 1 to ${contract.promptMax.toLocaleString()} characters.` : `Enter a prompt up to ${contract.promptMax.toLocaleString()} characters.`);
  }

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
  for (const limit of contract.maxAcrossRoles ?? []) {
    if (roles.filter((role) => limit.roles.includes(role)).length > limit.max) {
      invalid("too_many_media", `${contract.label} accepts at most ${limit.max} combined reference input${limit.max === 1 ? "" : "s"}.`);
    }
  }
  if (contract.prohibitedRoleCombinations?.some((combination) => combination.every((role) => roles.includes(role)))) {
    invalid("invalid_media_combination", `${contract.label} does not support this combination of source media.`);
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
  const parsedOptions = parsed.data ?? {};
  if (Object.keys(parsedOptions).some((key) => !contract.optionKeys.includes(key as keyof VideoOptions))) {
    invalid("invalid_options", `${contract.label} does not support one or more selected options.`);
  }
  const options = { ...contract.defaultOptions, ...parsedOptions };
  if (contract.requiredOptionKeys?.some((key) => options[key] === undefined)) {
    invalid("required_option_missing", `${contract.label} requires additional model-specific settings.`);
  }
  const durationMaximum = contract.duration && Math.min(contract.duration.max, ...roles.map((role) => contract.durationMaxByRole?.[role] ?? contract.duration!.max));
  if (options.duration !== undefined && (!contract.duration || options.duration < contract.duration.min || options.duration > (durationMaximum ?? contract.duration.max) || (contract.duration.values && !contract.duration.values.includes(options.duration)))) {
    invalid("invalid_duration", `${contract.label} does not support this duration.`);
  }
  if (options.resolution !== undefined && (!contract.resolutions || !contract.resolutions.includes(options.resolution))) {
    invalid("invalid_resolution", `${contract.label} does not support this resolution.`);
  }
  if (options.aspectRatio !== undefined && (!contract.aspectRatios || !contract.aspectRatios.includes(options.aspectRatio))) {
    invalid("invalid_aspect_ratio", `${contract.label} does not support this aspect ratio.`);
  }
  return { contract, prompt, media, options };
}
