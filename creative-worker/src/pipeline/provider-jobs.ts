import { createHash } from "node:crypto";

import type { GenerationInput, ProviderPoll } from "../contract.js";
import type { ProviderTaskStatus } from "../process-job.js";

/** Options on a provider job created by the pipeline (`creative_studio_jobs.options`). */
export type PipelineJobOptions = {
  takeId: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  endFrameStrength: number | null;
};

export type PipelineJob = {
  id: string;
  owner_user_id: string;
  project_id: string;
  model_id: string;
  prompt: string;
  seed?: number | null;
  options: Record<string, unknown>;
};

/** Stands in for a result URL when the provider already wrote the clip to the take's upload URL (Modal). */
export const UPLOADED_RESULT = "uploaded:raw.mp4";

export const isPipelineJob = (job: { options?: Record<string, unknown> | null }) => typeof job.options?.takeId === "string";

export const takeRawPath = (job: Pick<PipelineJob, "owner_user_id" | "project_id" | "options">) => (
  `owners/${job.owner_user_id}/projects/${job.project_id}/takes/${String(job.options.takeId)}/raw.mp4`
);

export function generationInput(job: PipelineJob, urls: { backgroundUrl: string; outputUploadUrl: string }): GenerationInput {
  const options = job.options as PipelineJobOptions;
  return {
    idempotencyKey: options.takeId,
    modelId: job.model_id,
    backgroundUrl: urls.backgroundUrl,
    outputUploadUrl: urls.outputUploadUrl,
    prompt: job.prompt,
    seed: job.seed ?? 0,
    width: options.width,
    height: options.height,
    frames: options.frames,
    fps: options.fps,
    ...(options.endFrameStrength !== null ? { endFrame: { strength: options.endFrameStrength } } : {}),
  };
}

export function taskStatus(poll: ProviderPoll): { status: ProviderTaskStatus; resultUrl?: string } {
  if (poll.state === "running") return { status: "RUNNING" };
  if (poll.state === "failed") return { status: "FAILED" };
  if (poll.uploaded) return { status: "SUCCEEDED", resultUrl: UPLOADED_RESULT };
  return poll.resultUrl ? { status: "SUCCEEDED", resultUrl: poll.resultUrl } : { status: "UNKNOWN" };
}

export type UploadedResultDependencies = {
  findAssetIdByPath: (objectPath: string) => Promise<string | null>;
  download: (objectPath: string) => Promise<Buffer | null>;
  insertAsset: (row: Record<string, unknown>) => Promise<boolean>;
};

const videoMaxBytes = 250 * 1024 * 1024;

/** Records the raw clip a provider uploaded to the take's path; an asset already recorded there is reused. */
export async function recordUploadedResult(
  job: PipelineJob & { provider?: string; provider_task_id: string | null },
  dependencies: UploadedResultDependencies,
) {
  const objectPath = takeRawPath(job);
  const recorded = await dependencies.findAssetIdByPath(objectPath);
  if (recorded) return { outputAssetId: recorded };
  const bytes = await dependencies.download(objectPath);
  if (!bytes?.byteLength || bytes.byteLength > videoMaxBytes) throw new Error("provider_result_missing");
  const assetId = crypto.randomUUID();
  const created = await dependencies.insertAsset({
    id: assetId,
    project_id: job.project_id,
    owner_user_id: job.owner_user_id,
    kind: "generated-video",
    name: "raw.mp4",
    mime_type: "video/mp4",
    object_path: objectPath,
    byte_size: bytes.byteLength,
    width: null,
    height: null,
    duration_seconds: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    provenance: { provider: job.provider ?? null, providerTaskId: job.provider_task_id, takeId: job.options.takeId },
  });
  if (created) return { outputAssetId: assetId };
  const concurrent = await dependencies.findAssetIdByPath(objectPath);
  if (!concurrent) throw new Error("creative_result_asset_write_failed");
  return { outputAssetId: concurrent };
}
