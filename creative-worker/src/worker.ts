import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { hasClaimedId } from "./claim.js";
import { runDirectorWorkerTick } from "./director.js";
import { processClaimedJob, type ClaimedCreativeJob, type ProviderTaskStatus } from "./process-job.js";
import { providerRequest, type ProviderMedia, type WorkerMediaRole } from "./provider.js";
import { runWorkflowWorkerTick } from "./workflows.js";

export type WorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  apiKey: string;
  workspaceId: string;
  directorModel?: string;
};

type WorkerJob = ClaimedCreativeJob & {
  owner_user_id: string;
  project_id: string;
  model_id: string;
  task: string;
  prompt: string;
  options: Record<string, unknown>;
  worker_lease_id: string | null;
};

type JobMediaRow = { asset_id: string; role: WorkerMediaRole; ordinal: number };
type AssetRow = { id: string; object_path: string; mime_type: string; name: string };

const videoMaxBytes = 250 * 1024 * 1024;

type JobUpdateStatus = "submitted" | "running" | "downloading" | "completed" | "failed" | "canceled" | "needs_attention";

export function jobLeasePatch(status: JobUpdateStatus) {
  return status === "downloading" ? {} : {
    worker_lease_id: null,
    worker_lease_expires_at: null,
  };
}

export function workerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig | null {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = env.DASHSCOPE_API_KEY;
  const workspaceId = env.ALIBABA_WORKSPACE_ID;
  return supabaseUrl && serviceRoleKey && apiKey && workspaceId
    ? { supabaseUrl, serviceRoleKey, apiKey, workspaceId, directorModel: env.CREATIVE_DIRECTOR_MODEL }
    : null;
}

const providerUrl = (workspaceId: string, path: string) => (
  `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1${path}`
);

const safeProviderError = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.slice(0, 80) : "provider_request_failed";
  throw new Error(`alibaba_${code}`);
};

async function submitAlibaba(job: WorkerJob, media: ProviderMedia[], config: WorkerConfig) {
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

async function pollAlibaba(taskId: string, config: WorkerConfig) {
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

export async function runWorkerTick(config: WorkerConfig) {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (await runDirectorWorkerTick(client, config)) return true;
  if (await runWorkflowWorkerTick(client)) return true;
  const claimed = await client.rpc("claim_creative_studio_job");
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
    const signed = await client.storage.from("creative-studio").createSignedUrl(asset.object_path, 300);
    if (signed.error || !signed.data?.signedUrl) throw new Error("creative_job_asset_sign_failed");
    providerMedia.push({ role: link.role, url: signed.data.signedUrl });
  }

  const update = async (
    status: JobUpdateStatus,
    providerTaskId?: string,
    outputAssetId?: string,
  ) => {
    const terminal = ["completed", "failed", "canceled", "needs_attention"].includes(status);
    const result = await client
      .from("creative_studio_jobs")
      .update({
        status,
        ...(providerTaskId ? { provider_task_id: providerTaskId } : {}),
        ...(outputAssetId ? { output_asset_id: outputAssetId } : {}),
        next_poll_at: new Date(Date.now() + (terminal ? 24 * 60 * 60 * 1000 : 15_000)).toISOString(),
        ...jobLeasePatch(status),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("worker_lease_id", job.worker_lease_id);
    if (result.error) throw new Error("creative_job_update_failed");
    const event = await client.from("creative_studio_job_events").insert({
      job_id: job.id,
      owner_user_id: job.owner_user_id,
      event_type: status,
      safe_detail: {},
    });
    if (event.error) throw new Error("creative_job_event_write_failed");
  };

  await processClaimedJob(job, {
    submit: () => submitAlibaba(job, providerMedia, config),
    poll: (taskId) => pollAlibaba(taskId, config),
    ingest: async (resultUrl) => {
      const url = new URL(resultUrl);
      if (url.protocol !== "https:") throw new Error("provider_result_invalid");
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const contentType = response.headers.get("content-type")?.split(";", 1)[0];
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok || contentType !== "video/mp4" || contentLength > videoMaxBytes) throw new Error("provider_result_invalid");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > videoMaxBytes) throw new Error("provider_result_invalid");
      const assetId = crypto.randomUUID();
      const objectPath = `owners/${job.owner_user_id}/projects/${job.project_id}/generated/${assetId}.mp4`;
      const uploaded = await client.storage.from("creative-studio").upload(objectPath, bytes, { contentType: "video/mp4", upsert: false });
      if (uploaded.error) throw new Error("creative_result_upload_failed");
      const asset = await client.from("creative_studio_assets").insert({
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
      if (asset.error) {
        await client.storage.from("creative-studio").remove([objectPath]);
        throw new Error("creative_result_asset_write_failed");
      }
      return { outputAssetId: assetId };
    },
    update,
  });
  return true;
}
