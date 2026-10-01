import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { budgetReserver, monthlyCapUsd, settleJobSpend } from "./budget.js";
import { hasClaimedId } from "./claim.js";
import type { ProviderId, ProviderPoll } from "./contract.js";
import { runDirectorWorkerTick } from "./director.js";
import {
  UPLOADED_RESULT,
  generationInput,
  isPipelineJob,
  recordUploadedResult,
  takeRawPath,
  taskStatus,
} from "./pipeline/provider-jobs.js";
import { supabasePipeline } from "./pipeline/store.js";
import { runPipelineTick } from "./pipeline/tick.js";
import type { ProviderRegistry } from "./providers/index.js";
import { MODEL_PROVIDERS, fallbackModel } from "./router.js";
import {
  LeaseLostError,
  processClaimedJob,
  type ClaimedCreativeJob,
  type JobPatch,
  type JobUpdateStatus,
  type ProviderTaskStatus,
} from "./process-job.js";
import { providerRequest, type ProviderMedia, type WorkerMediaRole } from "./provider.js";
import { dashscopePoll, dashscopeSubmit } from "./providers/alibaba.js";
import { runWorkflowWorkerTick } from "./workflows.js";

export type AlibabaConfig = {
  apiKey: string;
  workspaceId: string;
  directorModel?: string;
};

export type WorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  alibaba: AlibabaConfig | null;
  monthlyCapUsd: number;
};

export type WorkerClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  storage: { from: (bucket: string) => any };
};

type WorkerJob = ClaimedCreativeJob & {
  owner_user_id: string;
  project_id: string;
  provider?: ProviderId;
  model_id: string;
  task: string;
  prompt: string;
  options: Record<string, unknown>;
  worker_lease_id: string | null;
};

type JobMediaRow = { asset_id: string; role: WorkerMediaRole; ordinal: number };
type AssetRow = { id: string; object_path: string; mime_type: string; name: string };

const bucket = "creative-studio";
const videoMaxBytes = 250 * 1024 * 1024;

/** Keep the lease while the worker is still inside the step (calling the provider, ingesting the result). */
export function jobLeasePatch(status: JobUpdateStatus) {
  return status === "submitting" || status === "downloading" ? {} : {
    worker_lease_id: null,
    worker_lease_expires_at: null,
  };
}

/** Null only without Supabase. Provider credentials are optional; jobs for unconfigured providers stay queued. */
export function workerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig | null {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  const apiKey = env.DASHSCOPE_API_KEY;
  const workspaceId = env.ALIBABA_WORKSPACE_ID;
  return {
    supabaseUrl,
    serviceRoleKey,
    alibaba: apiKey && workspaceId ? { apiKey, workspaceId, directorModel: env.CREATIVE_DIRECTOR_MODEL } : null,
    monthlyCapUsd: monthlyCapUsd(env),
  };
}

/** Providers whose jobs this worker may claim: registered `VideoProvider`s plus the legacy Alibaba path. */
export function configuredProviders(config: WorkerConfig, registry: ProviderRegistry = {}): ProviderId[] {
  const ids = new Set(Object.keys(registry) as ProviderId[]);
  if (config.alibaba) ids.add("alibaba");
  return [...ids];
}

/** Plain reasons for work this worker leaves queued, logged once at start-up. */
export function skippedWork(config: WorkerConfig): string[] {
  return config.alibaba
    ? []
    : ["DASHSCOPE_API_KEY or ALIBABA_WORKSPACE_ID is not set: Alibaba jobs and director requests stay queued."];
}

async function submitAlibaba(job: WorkerJob, media: ProviderMedia[], config: AlibabaConfig) {
  const request = providerRequest({ modelId: job.model_id, task: job.task, prompt: job.prompt, options: job.options, media });
  return dashscopeSubmit(config, request);
}

async function pollAlibaba(taskId: string, config: AlibabaConfig) {
  const task = await dashscopePoll(config, taskId);
  return { status: task.status as ProviderTaskStatus, ...(task.videoUrl ? { resultUrl: task.videoUrl } : {}) };
}

const isTerminal = (status: JobUpdateStatus) => ["completed", "failed", "canceled", "needs_attention"].includes(status);
const nextPollAt = (status: JobUpdateStatus) => (
  new Date(Date.now() + (isTerminal(status) ? 24 * 60 * 60 * 1000 : 15_000)).toISOString()
);

/** Lease-guarded writes for one claimed job. Zero rows changed means the lease was lost: `LeaseLostError`. */
export function jobStore(client: WorkerClient, job: Pick<WorkerJob, "id" | "owner_user_id" | "worker_lease_id">) {
  const event = async (status: JobUpdateStatus, patch: JobPatch) => {
    const inserted = await client.from("creative_studio_job_events").insert({
      job_id: job.id,
      owner_user_id: job.owner_user_id,
      event_type: status,
      safe_detail: patch.errorCode ? { errorCode: patch.errorCode } : {},
    });
    if (inserted.error) throw new Error("creative_job_event_write_failed");
  };
  return {
    async update(status: JobUpdateStatus, patch: JobPatch = {}) {
      const result = await client
        .from("creative_studio_jobs")
        .update({
          status,
          ...(patch.providerTaskId ? { provider_task_id: patch.providerTaskId } : {}),
          ...(patch.outputAssetId ? { output_asset_id: patch.outputAssetId } : {}),
          ...(patch.submitAttemptId ? { submit_attempt_id: patch.submitAttemptId } : {}),
          ...(patch.errorCode ? { error_code: patch.errorCode } : {}),
          next_poll_at: nextPollAt(status),
          ...jobLeasePatch(status),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("worker_lease_id", job.worker_lease_id)
        .select("id");
      if (result.error) throw new Error("creative_job_update_failed");
      if (!result.data?.length) throw new LeaseLostError();
      await event(status, patch);
    },
    // Guarded by the submit attempt, not the lease: the provider task exists and must be recorded even if a
    // slow submit let the lease expire and another worker already flagged the job.
    async recordSubmitted(submitAttemptId: string, providerTaskId: string) {
      const result = await client
        .from("creative_studio_jobs")
        .update({
          status: "submitted",
          provider_task_id: providerTaskId,
          error_code: null,
          next_poll_at: nextPollAt("submitted"),
          worker_lease_id: null,
          worker_lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("submit_attempt_id", submitAttemptId)
        .is("provider_task_id", null)
        .in("status", ["submitting", "needs_attention"])
        .select("id");
      if (result.error || !result.data?.length) {
        console.error(`creative_job_submit_unrecorded job=${job.id} provider_task=${providerTaskId}`);
        if (result.error) throw new Error("creative_job_update_failed");
        throw new LeaseLostError();
      }
      await event("submitted", {});
    },
    async recordCost(costUsd: number | null, gpuSeconds: number | null) {
      const result = await client
        .from("creative_studio_jobs")
        .update({ cost_usd: costUsd, gpu_seconds: gpuSeconds, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("worker_lease_id", job.worker_lease_id)
        .select("id");
      if (result.error) throw new Error("creative_job_update_failed");
      if (!result.data?.length) throw new LeaseLostError();
    },
  };
}

export const generatedVideoPath = (job: Pick<WorkerJob, "id" | "owner_user_id" | "project_id">) => (
  `owners/${job.owner_user_id}/projects/${job.project_id}/generated/${job.id}.mp4`
);

export type IngestDependencies = {
  fetch: typeof fetch;
  findAssetIdByPath: (objectPath: string) => Promise<string | null>;
  objectInfo: (objectPath: string) => Promise<{ size: number; contentType: string | null } | null>;
  upload: (objectPath: string, bytes: Buffer) => Promise<void>;
  /** Returns false when an asset with this object path already exists. */
  insertAsset: (row: Record<string, unknown>) => Promise<boolean>;
};

/** Idempotent: one fixed path per job, and an asset already recorded there (or a complete file) counts as done. */
export async function ingestProviderResult(
  job: Pick<WorkerJob, "id" | "owner_user_id" | "project_id" | "provider_task_id" | "provider">,
  resultUrl: string,
  dependencies: IngestDependencies,
  objectPath = generatedVideoPath(job),
) {
  const recorded = await dependencies.findAssetIdByPath(objectPath);
  if (recorded) return { outputAssetId: recorded };

  const url = new URL(resultUrl);
  if (url.protocol !== "https:") throw new Error("provider_result_invalid");
  const response = await dependencies.fetch(url, { signal: AbortSignal.timeout(60_000) });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || contentType !== "video/mp4" || contentLength > videoMaxBytes) throw new Error("provider_result_invalid");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > videoMaxBytes) throw new Error("provider_result_invalid");

  const stored = await dependencies.objectInfo(objectPath);
  if (!stored || stored.size !== bytes.byteLength || stored.contentType !== "video/mp4") {
    await dependencies.upload(objectPath, bytes);
  }
  const assetId = crypto.randomUUID();
  const created = await dependencies.insertAsset({
    id: assetId,
    project_id: job.project_id,
    owner_user_id: job.owner_user_id,
    kind: "generated-video",
    name: "Generated video.mp4",
    mime_type: "video/mp4",
    object_path: objectPath,
    byte_size: bytes.byteLength,
    width: null,
    height: null,
    duration_seconds: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    provenance: { provider: job.provider ?? "alibaba", providerTaskId: job.provider_task_id },
  });
  if (created) return { outputAssetId: assetId };
  const concurrent = await dependencies.findAssetIdByPath(objectPath);
  if (!concurrent) throw new Error("creative_result_asset_write_failed");
  return { outputAssetId: concurrent };
}

function storageIngest(client: WorkerClient, ownerUserId: string): IngestDependencies {
  return {
    fetch,
    findAssetIdByPath: async (objectPath) => {
      const found = await client
        .from("creative_studio_assets")
        .select("id")
        .eq("owner_user_id", ownerUserId)
        .eq("object_path", objectPath)
        .maybeSingle();
      if (found.error) throw new Error("creative_result_asset_read_failed");
      return found.data?.id ?? null;
    },
    objectInfo: async (objectPath) => {
      const info = await client.storage.from(bucket).info(objectPath);
      return info.error || !info.data ? null : { size: Number(info.data.size ?? 0), contentType: info.data.contentType ?? null };
    },
    upload: async (objectPath, bytes) => {
      // The path belongs to this job only, so replacing a partial upload from a crashed attempt is safe.
      const uploaded = await client.storage.from(bucket).upload(objectPath, bytes, { contentType: "video/mp4", upsert: true });
      if (uploaded.error) throw new Error("creative_result_upload_failed");
    },
    insertAsset: async (row) => {
      const inserted = await client.from("creative_studio_assets").insert(row);
      if (!inserted.error) return true;
      if (inserted.error.code === "23505") return false;
      throw new Error("creative_result_asset_write_failed");
    },
  };
}

export const createWorkerClient = (config: WorkerConfig): WorkerClient => createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Pipeline steps against Supabase, with the monthly budget cap reserved before every paid take. */
export function pipelineDependencies(client: WorkerClient, registry: ProviderRegistry, capUsd: number) {
  return supabasePipeline(client, {
    providerReady: (modelId) => {
      const provider = MODEL_PROVIDERS[modelId];
      return Boolean(provider && registry[provider]);
    },
    fallback: (run) => fallbackModel({ modelId: run.model_id, allowFallback: run.allow_fallback }),
    reserveBudget: budgetReserver(client, capUsd),
    settleSpend: async (jobId) => {
      await settleJobSpend(client, jobId);
    },
  });
}

const TERMINAL_JOB = ["completed", "failed", "canceled"];
/** Task id for a take whose raw.mp4 was already in storage: no provider was called for it. */
const ALREADY_UPLOADED = "already-uploaded:";

async function runPipelineJob(client: WorkerClient, job: WorkerJob & { input_assets?: unknown }, registry: ProviderRegistry) {
  const store = jobStore(client, job);
  const provider = job.provider ? registry[job.provider] : undefined;
  let lastPoll: ProviderPoll | null = null;
  let finalStatus: JobUpdateStatus | null = null;
  const ingest = storageIngest(client, job.owner_user_id);
  try {
    if (!provider) {
      await store.update("needs_attention", { errorCode: "provider_not_configured" });
      return true;
    }
    await processClaimedJob(job, {
      submit: async () => {
        // An earlier attempt may have finished uploading before the worker recorded it. Use that clip and
        // start no new provider call (a second GPU render or a second billable Alibaba task).
        const existing = await client.storage.from(bucket).info(takeRawPath(job));
        if (existing.error) {
          // Storage's object-not-found response has HTTP 400 but statusCode "404".
          // Every other failure leaves existence unknown: submitting could pay twice.
          const error = existing.error as { statusCode?: unknown; status?: unknown };
          if (Number(error.statusCode ?? error.status) !== 404) throw new Error("creative_job_storage_check_failed");
        } else {
          const size = Number(existing.data?.size ?? 0);
          if (!existing.data || !Number.isFinite(size) || size <= 0 || size > videoMaxBytes || existing.data.contentType !== "video/mp4") {
            throw new Error("creative_job_existing_output_invalid");
          }
          return `${ALREADY_UPLOADED}${String(job.options.takeId)}`;
        }
        const media = Array.isArray(job.input_assets) ? job.input_assets as Array<{ assetId: string; role: string }> : [];
        const backgroundId = media.find((item) => item.role === "first_frame")?.assetId;
        const background = backgroundId ? await client.from("creative_studio_assets").select("object_path")
          .eq("id", backgroundId).eq("owner_user_id", job.owner_user_id).maybeSingle() : null;
        if (!background?.data) throw new Error("creative_job_asset_read_failed");
        const download = await client.storage.from(bucket).createSignedUrl(background.data.object_path, 300);
        const upload = await client.storage.from(bucket).createSignedUploadUrl(takeRawPath(job), { upsert: true });
        if (download.error || !download.data?.signedUrl || upload.error || !upload.data?.signedUrl) {
          throw new Error("creative_job_asset_sign_failed");
        }
        const input = generationInput(job, { backgroundUrl: download.data.signedUrl, outputUploadUrl: upload.data.signedUrl });
        return (await provider.submit(input)).providerTaskId;
      },
      recordSubmitted: store.recordSubmitted,
      poll: async (taskId) => {
        // The cost of the earlier attempt that made this clip is unknown here, so none is recorded for it.
        lastPoll = taskId.startsWith(ALREADY_UPLOADED) ? { state: "succeeded", uploaded: true } : await provider.poll(taskId);
        return taskStatus(lastPoll);
      },
      ingest: async (resultUrl) => {
        const result = resultUrl === UPLOADED_RESULT
          ? await recordUploadedResult(job, {
            findAssetIdByPath: ingest.findAssetIdByPath,
            insertAsset: ingest.insertAsset,
            download: async (objectPath) => {
              const file = await client.storage.from(bucket).download(objectPath);
              return file.error || !file.data ? null : Buffer.from(await file.data.arrayBuffer());
            },
          })
          : await ingestProviderResult(job, resultUrl, ingest, takeRawPath(job));
        const poll = lastPoll as ProviderPoll | null;
        if (poll?.state === "succeeded") await store.recordCost(poll.costUsd ?? null, poll.gpuSeconds ?? null);
        return result;
      },
      update: async (status, patch) => {
        await store.update(status, patch);
        finalStatus = status;
      },
    });
  } catch (error) {
    if (error instanceof LeaseLostError) return true;
    throw error;
  }
  if (finalStatus && TERMINAL_JOB.includes(finalStatus)) {
    // The pipeline settles again when it sees the job end, so a failure here is only logged.
    await settleJobSpend(client, job.id).catch(() => console.warn(`budget_settle_deferred job=${job.id}`));
  }
  return true;
}

export async function runWorkerTick(
  config: WorkerConfig,
  client: WorkerClient = createWorkerClient(config),
  registry: ProviderRegistry = {},
) {
  if (config.alibaba && await runDirectorWorkerTick(client, config.alibaba)) return true;
  if (await runWorkflowWorkerTick(client)) return true;
  if (await runPipelineTick(client, pipelineDependencies(client, registry, config.monthlyCapUsd))) return true;
  const providers = configuredProviders(config, registry);
  if (!providers.length) return false;
  const claimed = await client.rpc("claim_creative_studio_provider_job", { allowed_providers: providers });
  if (claimed.error) throw new Error("creative_job_claim_failed");
  if (!hasClaimedId(claimed.data)) return false;
  const job = claimed.data as unknown as WorkerJob;
  if (isPipelineJob(job)) return runPipelineJob(client, job, registry);
  const alibaba = config.alibaba;
  if (!alibaba) {
    try {
      await jobStore(client, job).update("needs_attention", { errorCode: "provider_not_configured" });
    } catch (error) {
      if (!(error instanceof LeaseLostError)) throw error;
    }
    return true;
  }
  const mediaRows = await client
    .from("creative_studio_job_media")
    .select("asset_id,role,ordinal")
    .eq("job_id", job.id)
    .eq("owner_user_id", job.owner_user_id)
    .order("ordinal", { ascending: true });
  if (mediaRows.error) throw new Error("creative_job_media_read_failed");
  const links = (mediaRows.data ?? []) as JobMediaRow[];
  const assetIds = [...new Set(links.map((link) => link.asset_id))];
  const assets = assetIds.length ? await client
    .from("creative_studio_assets")
    .select("id,object_path,mime_type,name")
    .eq("owner_user_id", job.owner_user_id)
    .in("id", assetIds) : { data: [], error: null };
  if (assets.error || assets.data?.length !== assetIds.length) throw new Error("creative_job_asset_read_failed");
  const assetById = new Map((assets.data as AssetRow[]).map((asset) => [asset.id, asset]));
  const providerMedia: ProviderMedia[] = [];
  for (const link of links) {
    const asset = assetById.get(link.asset_id);
    if (!asset) throw new Error("creative_job_asset_read_failed");
    const signed = await client.storage.from(bucket).createSignedUrl(asset.object_path, 300);
    if (signed.error || !signed.data?.signedUrl) throw new Error("creative_job_asset_sign_failed");
    providerMedia.push({ role: link.role, url: signed.data.signedUrl });
  }

  const store = jobStore(client, job);
  try {
    await processClaimedJob(job, {
      submit: () => submitAlibaba(job, providerMedia, alibaba),
      recordSubmitted: store.recordSubmitted,
      poll: (taskId) => pollAlibaba(taskId, alibaba),
      ingest: (resultUrl) => ingestProviderResult(job, resultUrl, storageIngest(client, job.owner_user_id)),
      update: store.update,
    });
  } catch (error) {
    if (error instanceof LeaseLostError) return true;
    throw error;
  }
  return true;
}
