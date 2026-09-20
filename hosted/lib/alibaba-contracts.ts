import { StudioError } from "@/lib/errors";
import { getVideoModelContract, type MediaRole, type VideoOptions } from "@/lib/video-catalog";

export type SignedProviderMedia = {
  role: MediaRole;
  url: string;
};

export type AlibabaSubmitRequest = {
  path: "/services/aigc/video-generation/video-synthesis" | "/services/aigc/image2video/video-synthesis";
  body: {
    model: string;
    input: Record<string, unknown>;
    parameters: Record<string, unknown>;
  };
};

const roleType: Record<Exclude<MediaRole, "driving_video">, string> = {
  first_frame: "first_frame",
  last_frame: "last_frame",
  mask_image: "reference_image",
  reference_image: "reference_image",
  reference_video: "reference_video",
  source_video: "video",
  driving_audio: "driving_audio",
  first_clip: "first_clip",
};

const standardParameters = (options: VideoOptions) => ({
  ...(options.duration === undefined ? {} : { duration: options.duration }),
  ...(options.resolution === undefined ? {} : { resolution: options.resolution }),
  ...(options.aspectRatio === undefined || options.aspectRatio === "adaptive" ? {} : { ratio: options.aspectRatio }),
  ...(options.promptExtend === undefined ? {} : { prompt_extend: options.promptExtend }),
  ...(options.watermark === undefined ? {} : { watermark: options.watermark }),
  ...(options.audio === undefined ? {} : { audio: options.audio }),
});

const requiredUrl = (media: readonly SignedProviderMedia[], role: MediaRole, label: string) => {
  const url = media.find((entry) => entry.role === role)?.url;
  if (!url) throw new StudioError(400, "required_media_missing", `${label} is required for this Alibaba model.`);
  return url;
};

export function serializeAlibabaSubmit(input: {
  contractId: string;
  prompt: string;
  options: VideoOptions;
  media: readonly SignedProviderMedia[];
}): AlibabaSubmitRequest {
  const contract = getVideoModelContract(input.contractId);
  if (!contract) throw new StudioError(400, "unsupported_model", "Choose a Singapore video model from the Studio catalogue.");

  if (contract.task === "animate-move" || contract.task === "animate-mix") {
    return {
      path: "/services/aigc/image2video/video-synthesis",
      body: {
        model: contract.providerModel,
        input: {
          image_url: requiredUrl(input.media, "first_frame", "Character image"),
          video_url: requiredUrl(input.media, "driving_video", "Reference video"),
          ...(input.options.watermark === undefined ? {} : { watermark: input.options.watermark }),
        },
        parameters: { mode: input.options.mode ?? "wan-std" },
      },
    };
  }

  if (contract.providerModel === "wan2.1-vace-plus") {
    const operation = input.options.operation;
    if (!operation) throw new StudioError(400, "vace_operation_missing", "Choose a VACE operation.");
    const referenceImages = input.media.filter((entry) => entry.role === "reference_image").map((entry) => entry.url);
    const sourceVideo = input.media.find((entry) => entry.role === "source_video")?.url;
    const firstClip = input.media.find((entry) => entry.role === "first_clip")?.url;
    const maskImage = input.media.find((entry) => entry.role === "mask_image")?.url;
    const inputBody: Record<string, unknown> = { function: operation, ...(input.prompt ? { prompt: input.prompt } : {}) };
    if (operation === "image_reference") inputBody.ref_images_url = referenceImages;
    if (operation === "video_repainting" || operation === "video_outpainting") inputBody.video_url = requiredUrl(input.media, "source_video", "Source video");
    if (operation === "video_edit") {
      inputBody.video_url = requiredUrl(input.media, "source_video", "Source video");
      inputBody.mask_image_url = requiredUrl(input.media, "mask_image", "Mask image");
    }
    if (operation === "video_extension") inputBody.first_clip_url = requiredUrl(input.media, "first_clip", "First clip");
    return {
      path: "/services/aigc/video-generation/video-synthesis",
      body: {
        model: contract.providerModel,
        input: inputBody,
        parameters: standardParameters(input.options),
      },
    };
  }

  const media = input.media.map((entry) => {
    const type = roleType[entry.role as Exclude<MediaRole, "driving_video">];
    if (!type) throw new StudioError(400, "invalid_media_role", `${contract.label} does not accept ${entry.role.replaceAll("_", " ")}.`);
    return { type, url: entry.url };
  });

  return {
    path: "/services/aigc/video-generation/video-synthesis",
    body: {
      model: contract.providerModel,
      input: {
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(media.length ? { media } : {}),
      },
      parameters: standardParameters(input.options),
    },
  };
}

export function workspaceUrl(workspaceId: string, path: AlibabaSubmitRequest["path"]) {
  return `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1${path}`;
}
