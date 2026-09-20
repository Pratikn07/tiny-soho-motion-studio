export type WorkerMediaRole =
  | "first_frame"
  | "last_frame"
  | "mask_image"
  | "reference_image"
  | "reference_video"
  | "source_video"
  | "driving_video"
  | "driving_audio"
  | "first_clip";

export type ProviderMedia = { role: WorkerMediaRole; url: string };

type ProviderInput = Record<string, unknown> & {
  media?: Array<{ type: string; url: string }>;
};

export type ProviderRequest = {
  path: "/services/aigc/video-generation/video-synthesis" | "/services/aigc/image2video/video-synthesis";
  body: { model: string; input: ProviderInput; parameters: Record<string, unknown> };
};

const roleType: Record<Exclude<WorkerMediaRole, "driving_video">, string> = {
  first_frame: "first_frame",
  last_frame: "last_frame",
  mask_image: "reference_image",
  reference_image: "reference_image",
  reference_video: "reference_video",
  source_video: "video",
  driving_audio: "driving_audio",
  first_clip: "first_clip",
};

const value = (media: readonly ProviderMedia[], role: WorkerMediaRole) => media.find((item) => item.role === role)?.url;

const standardParameters = (options: Record<string, unknown>) => ({
  ...(typeof options.duration === "number" ? { duration: options.duration } : {}),
  ...(typeof options.resolution === "string" ? { resolution: options.resolution } : {}),
  ...(typeof options.aspectRatio === "string" && options.aspectRatio !== "adaptive" ? { ratio: options.aspectRatio } : {}),
  ...(typeof options.promptExtend === "boolean" ? { prompt_extend: options.promptExtend } : {}),
  ...(typeof options.watermark === "boolean" ? { watermark: options.watermark } : {}),
  ...(options.shotType === "single" || options.shotType === "multi" ? { shot_type: options.shotType } : {}),
  ...(typeof options.audio === "boolean" ? { audio: options.audio } : {}),
  ...(options.audioSetting === "auto" || options.audioSetting === "origin" ? { audio_setting: options.audioSetting } : {}),
});

const legacySize = (resolution: unknown, aspectRatio: unknown) => {
  const tier = typeof resolution === "string" ? resolution : "720P";
  const ratio = typeof aspectRatio === "string" ? aspectRatio : "16:9";
  const sizes: Record<string, Record<string, string>> = {
    "480P": { "16:9": "832*480", "9:16": "480*832", "1:1": "624*624" },
    "720P": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1088*832", "3:4": "832*1088" },
    "1080P": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1632*1248", "3:4": "1248*1632" },
  };
  return sizes[tier]?.[ratio] ?? sizes[tier]?.["16:9"] ?? "1280*720";
};

const legacyTextParameters = (options: Record<string, unknown>) => ({
  ...(typeof options.duration === "number" ? { duration: options.duration } : {}),
  size: legacySize(options.resolution, options.aspectRatio),
  ...(typeof options.promptExtend === "boolean" ? { prompt_extend: options.promptExtend } : {}),
  ...(typeof options.watermark === "boolean" ? { watermark: options.watermark } : {}),
  ...(options.shotType === "single" || options.shotType === "multi" ? { shot_type: options.shotType } : {}),
});

const isLegacyTextModel = (model: string) => /^wan2\.(1|2|5|6)-t2v/.test(model);
const isLegacyImageModel = (model: string) => /^wan2\.(1|2|5|6)-i2v/.test(model);
const isLegacyReferenceModel = (model: string) => /^wan2\.6-r2v/.test(model);
const isKeyframeModel = (model: string) => /^wan2\.(1|2)-kf2v/.test(model);

export function providerRequest(input: {
  modelId: string;
  task: string;
  prompt: string;
  options: Record<string, unknown>;
  media: readonly ProviderMedia[];
}): ProviderRequest {
  const providerModel = input.modelId.startsWith("wan2.1-vace-plus:")
    ? "wan2.1-vace-plus"
    : input.modelId.split(":", 1)[0];

  if (input.task === "animate-move" || input.task === "animate-mix") {
    const imageUrl = value(input.media, "first_frame");
    const videoUrl = value(input.media, "driving_video");
    if (!imageUrl || !videoUrl) throw new Error("Animation requires a character image and motion video.");
    return {
      path: "/services/aigc/image2video/video-synthesis",
      body: {
        model: providerModel,
        input: { image_url: imageUrl, video_url: videoUrl, ...(typeof input.options.watermark === "boolean" ? { watermark: input.options.watermark } : {}) },
        parameters: { mode: input.options.mode === "wan-pro" ? "wan-pro" : "wan-std" },
      },
    };
  }

  if (providerModel === "wan2.1-vace-plus") {
    const operation = input.options.operation;
    if (typeof operation !== "string") throw new Error("VACE requires an operation.");
    const inputBody: ProviderInput = { function: operation, ...(input.prompt ? { prompt: input.prompt } : {}) };
    if (operation === "image_reference") inputBody.ref_images_url = input.media.filter((item) => item.role === "reference_image").map((item) => item.url);
    if (operation === "video_repainting" || operation === "video_outpainting") inputBody.video_url = value(input.media, "source_video");
    if (operation === "video_edit") {
      inputBody.video_url = value(input.media, "source_video");
      inputBody.mask_image_url = value(input.media, "mask_image");
      inputBody.mask_frame_id = input.options.maskFrameId;
    }
    if (operation === "video_extension") inputBody.first_clip_url = value(input.media, "first_clip");
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: providerModel,
        input: inputBody,
        parameters: {
          ...standardParameters(input.options),
          ...(input.options.maskType === "tracking" || input.options.maskType === "manual" ? { mask_type: input.options.maskType } : {}),
          ...(typeof input.options.expandRatio === "number" ? { expand_ratio: input.options.expandRatio } : {}),
          ...(typeof input.options.topScale === "number" ? { top_scale: input.options.topScale } : {}),
          ...(typeof input.options.bottomScale === "number" ? { bottom_scale: input.options.bottomScale } : {}),
          ...(typeof input.options.leftScale === "number" ? { left_scale: input.options.leftScale } : {}),
          ...(typeof input.options.rightScale === "number" ? { right_scale: input.options.rightScale } : {}),
        },
      },
    };
  }

  if (isLegacyTextModel(providerModel)) {
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: providerModel,
        input: { ...(input.prompt ? { prompt: input.prompt } : {}), ...(value(input.media, "driving_audio") ? { audio_url: value(input.media, "driving_audio") } : {}) },
        parameters: legacyTextParameters(input.options),
      },
    };
  }

  if (isLegacyImageModel(providerModel)) {
    const imageUrl = value(input.media, "first_frame");
    if (!imageUrl) throw new Error("Image-to-video requires a first-frame image.");
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: providerModel,
        input: { ...(input.prompt ? { prompt: input.prompt } : {}), img_url: imageUrl, ...(value(input.media, "driving_audio") ? { audio_url: value(input.media, "driving_audio") } : {}) },
        parameters: standardParameters(input.options),
      },
    };
  }

  if (isKeyframeModel(providerModel)) {
    const firstFrameUrl = value(input.media, "first_frame");
    const lastFrameUrl = value(input.media, "last_frame");
    if (!firstFrameUrl || !lastFrameUrl) throw new Error("Keyframe-to-video requires first and last frame images.");
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: providerModel,
        input: { ...(input.prompt ? { prompt: input.prompt } : {}), first_frame_url: firstFrameUrl, last_frame_url: lastFrameUrl },
        parameters: standardParameters(input.options),
      },
    };
  }

  if (providerModel.startsWith("wan2.7-t2v")) {
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: providerModel,
        input: { ...(input.prompt ? { prompt: input.prompt } : {}), ...(value(input.media, "driving_audio") ? { audio_url: value(input.media, "driving_audio") } : {}) },
        parameters: standardParameters(input.options),
      },
    };
  }

  if (isLegacyReferenceModel(providerModel)) {
    const referenceUrls = input.media
      .filter((item) => item.role === "reference_image" || item.role === "reference_video")
      .map((item) => item.url);
    if (!referenceUrls.length) throw new Error("Reference-to-video requires reference media.");
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: providerModel,
        input: { ...(input.prompt ? { prompt: input.prompt } : {}), reference_urls: referenceUrls },
        parameters: {
          ...legacyTextParameters(input.options),
          ...(typeof input.options.audio === "boolean" ? { audio: input.options.audio } : {}),
        },
      },
    };
  }

  const voices = input.media.filter((item) => item.role === "driving_audio").map((item) => item.url);
  let voiceIndex = 0;
  const media = input.media.filter((item) => item.role !== "driving_audio").map((item) => {
    const type = roleType[item.role as Exclude<WorkerMediaRole, "driving_video">];
    if (!type) throw new Error(`Unsupported provider media role: ${item.role}`);
    const voice = item.role === "reference_image" || item.role === "reference_video" ? voices[voiceIndex++] : undefined;
    return { type, url: item.url, ...(voice ? { reference_voice: voice } : {}) };
  });
  return {
    path: "/services/aigc/video-generation/video-synthesis",
    body: {
      model: providerModel,
      input: { ...(input.prompt ? { prompt: input.prompt } : {}), ...(media.length ? { media } : {}) },
      parameters: standardParameters(input.options),
    },
  };
}
