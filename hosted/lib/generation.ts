import { createHash } from "node:crypto";

import { StudioError } from "@/lib/errors";
import { getHostedModel, type HostedModelId } from "@/lib/models";

export type GenerationMedia = {
  assetId: string;
  role: "start-image" | "end-image";
};

export type GenerationOptions = {
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
};

export type PreparedGeneration = {
  modelId: HostedModelId;
  prompt: string;
  media: GenerationMedia[];
  options: Required<GenerationOptions>;
};

const invalid = (code: string, message: string): never => {
  throw new StudioError(400, code, message);
};

export function preflightGeneration(input: {
  modelId: string;
  prompt: string;
  media: GenerationMedia[];
  options: GenerationOptions;
  freeQuotaModels: string[];
}): PreparedGeneration {
  const model = getHostedModel(input.modelId);
  if (!model) {
    throw new StudioError(400, "unsupported_model", "Choose a supported free-quota model.");
  }
  if (!input.freeQuotaModels.includes(model.id)) {
    invalid("free_quota_not_confirmed", "Confirm Free Quota for this model before generating.");
  }

  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 5000) {
    invalid("invalid_prompt", "Enter a prompt from 1 to 5,000 characters.");
  }

  const startImages = input.media.filter((media) => media.role === "start-image");
  const endImages = input.media.filter((media) => media.role === "end-image");
  if (startImages.length !== 1) invalid("start_image_required", "Exactly one start image is required.");
  if (endImages.length > 1 || input.media.length !== startImages.length + endImages.length) {
    invalid("invalid_media", "Use one start image and an optional end image.");
  }

  const duration = input.options.duration ?? model.duration.defaultValue;
  const resolution = input.options.resolution ?? model.resolutions[0];
  const aspectRatio = input.options.aspectRatio ?? model.aspectRatios?.[0] ?? "adaptive";
  if (!Number.isInteger(duration) || duration < model.duration.min || duration > model.duration.max) {
    invalid("invalid_duration", `Choose a duration from ${model.duration.min} to ${model.duration.max} seconds.`);
  }
  if (!model.resolutions.includes(resolution)) {
    invalid("invalid_resolution", "Choose a supported resolution.");
  }
  if (model.aspectRatios && !model.aspectRatios.includes(aspectRatio)) {
    invalid("invalid_aspect_ratio", "Choose a supported aspect ratio.");
  }
  if (!model.aspectRatios && input.options.aspectRatio !== undefined) {
    invalid("invalid_aspect_ratio", "This model derives its ratio from the start image.");
  }

  return {
    modelId: model.id,
    prompt,
    media: input.media,
    options: { duration, resolution, aspectRatio },
  };
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export function generationFingerprint(request: unknown) {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}
