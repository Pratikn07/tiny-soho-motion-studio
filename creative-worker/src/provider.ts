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
  ...(typeof options.audio === "boolean" ? { audio: options.audio } : {}),
});

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
    }
    if (operation === "video_extension") inputBody.first_clip_url = value(input.media, "first_clip");
    return { path: "/services/aigc/video-generation/video-synthesis", body: { model: providerModel, input: inputBody, parameters: standardParameters(input.options) } };
  }

  const media = input.media.map((item) => {
    const type = roleType[item.role as Exclude<WorkerMediaRole, "driving_video">];
    if (!type) throw new Error(`Unsupported provider media role: ${item.role}`);
    return { type, url: item.url };
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
