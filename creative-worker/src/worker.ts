import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { hasClaimedId } from "./claim.js";
import type { ProviderId } from "./contract.js";
import { runDirectorWorkerTick } from "./director.js";
import {
  LeaseLostError,
  processClaimedJob,
  type ClaimedCreativeJob,
  type JobPatch,
  type JobUpdateStatus,
  type ProviderTaskStatus,
} from "./process-job.js";
import { providerRequest, type ProviderMedia, type WorkerMediaRole } from "./provider.js";
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
  };
}

export function configuredProviders(config: WorkerConfig): ProviderId[] {
  return config.alibaba ? ["alibaba"] : [];
}

/** Plain reasons for work this worker leaves queued, logged once at start-up. */
export function skippedWork(config: WorkerConfig): string[] {
  return config.alibaba
    ? []
    : ["DASHSCOPE_API_KEY or ALIBABA_WORKSPACE_ID is not set: Alibaba jobs and director requests stay queued."];
}

const providerUrl = (workspaceId: string, path: string) => (
  `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1${path}`
);

const safeProviderError = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.slice(0, 80) : "provider_request_failed";
  throw new Error(`alibaba_${code}`);
};

async function submitAlibaba(job: WorkerJob, media: ProviderMedia[], config: AlibabaConfig) {
  const request = providerRequest({ modelId: job.model_id, task: job.task, prompt: job.prompt, options: job.options, media });
  const response = await fetch(providerUrl(config.workspaceId, request.path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) await safeProviderError(response);
  const body = await response.json() as { output?: { task_id?: string } };
  if (!body.output?.task_id) throw new Error("alibaba_missing_task_id");
  return body.output.task_id;
}

async function pollAlibaba(taskId: string, config: AlibabaConfig) {
  const response = await fetch(`${providerUrl(config.workspaceId, "")}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) await safeProviderError(response);
  const body = await response.json() as { output?: { task_status?: string; video_url?: string } };
  const candidate = String(body.output?.task_status ?? "UNKNOWN").toUpperCase();
  const status = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"].includes(candidate)
    ? candidate as ProviderTaskStatus
    : "UNKNOWN";
  return { status, ...(typeof body.output?.video_url === "string" ? { resultUrl: body.output.video_url } : {}) };
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
  job: Pick<WorkerJob, "id" | "owner_user_id" | "project_id" | "provider_task_id">,
  resultUrl: string,
  dependencies: IngestDependencies,
) {
  const objectPath = generatedVideoPath(job);
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
    provenance: { provider: "alibaba", providerTaskId: job.provider_task_id },
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

export async function runWorkerTick(config: WorkerConfig, client: WorkerClient = createWorkerClient(config)) {
  if (config.alibaba && await runDirectorWorkerTick(client, config.alibaba)) return true;
  if (await runWorkflowWorkerTick(client)) return true;
  const alibaba = config.alibaba;
  const providers = configuredProviders(config);
  if (!alibaba || !providers.length) return false;
  const claimed = await client.rpc("claim_creative_studio_provider_job", { allowed_providers: providers });
  if (claimed.error) throw new Error("creative_job_claim_failed");
  if (!hasClaimedId(claimed.data)) return false;
  const job = claimed.data as unknown as WorkerJob;
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
