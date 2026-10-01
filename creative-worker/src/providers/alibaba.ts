import type { GenerationInput, ProviderPoll, VideoProvider } from "../contract.js";
import { providerRequest, type ProviderMedia, type ProviderRequest } from "../provider.js";

export type DashScopeConfig = { apiKey: string; workspaceId: string };
type Fetch = typeof fetch;

/** Catalog model → request contract in hosted/lib/video-catalog.ts (the provider model is its prefix). */
export const ALIBABA_CONTRACT_IDS: Readonly<Record<string, string>> = {
  "wan2.7-i2v": "wan2.7-i2v",
  "wan3-i2v": "wan3.0-video:image-to-video",
};

/** Catalog prices per billed video second (hosted/lib/catalog/models.ts); a hosted test keeps them equal. */
export const ALIBABA_USD_PER_VIDEO_SECOND: Readonly<Record<string, number>> = {
  "wan2.7-i2v": 0.1,
  "wan3-i2v": 0.1,
};

const endpoint = (workspaceId: string, path: string) => `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1${path}`;

const providerError = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.slice(0, 80) : "provider_request_failed";
  return new Error(`alibaba_${code}`);
};

/** Submits an async DashScope task. Errors carry only DashScope's code, never its body or the request. */
export async function dashscopeSubmit(config: DashScopeConfig, request: ProviderRequest, fetcher: Fetch = fetch) {
  const response = await fetcher(endpoint(config.workspaceId, request.path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw await providerError(response);
  const body = await response.json() as { output?: { task_id?: string } };
  if (!body.output?.task_id) throw new Error("alibaba_missing_task_id");
  return body.output.task_id;
}

export type DashScopeTask = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
  videoUrl?: string;
  code?: string;
  billedSeconds?: number;
};

export async function dashscopePoll(config: DashScopeConfig, taskId: string, fetcher: Fetch = fetch): Promise<DashScopeTask> {
  const response = await fetcher(`${endpoint(config.workspaceId, "")}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await providerError(response);
  const body = await response.json() as {
    output?: { task_status?: string; video_url?: string; code?: string };
    usage?: { duration?: number } | null;
  };
  const candidate = String(body.output?.task_status ?? "UNKNOWN").toUpperCase();
  const status = (["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"].includes(candidate) ? candidate : "UNKNOWN") as DashScopeTask["status"];
  return {
    status,
    ...(typeof body.output?.video_url === "string" ? { videoUrl: body.output.video_url } : {}),
    ...(typeof body.output?.code === "string" ? { code: body.output.code.slice(0, 80) } : {}),
    ...(typeof body.usage?.duration === "number" ? { billedSeconds: body.usage.duration } : {}),
  };
}

/**
 * The DashScope request for one take: the background as first frame (and as last frame when pinned), the exact
 * prompt (DashScope's prompt rewriting off), 720P, the take's seed and length. The text layer is never sent.
 */
export function alibabaRequest(input: GenerationInput): ProviderRequest {
  const contractId = ALIBABA_CONTRACT_IDS[input.modelId];
  if (!contractId) throw new Error("alibaba_model_unsupported");
  const media: ProviderMedia[] = [
    { role: "first_frame", url: input.backgroundUrl },
    ...(input.endFrame ? [{ role: "last_frame" as const, url: input.backgroundUrl }] : []),
  ];
  const request = providerRequest({
    modelId: contractId,
    task: "image-to-video",
    prompt: input.prompt,
    options: { duration: Math.round(input.frames / input.fps), resolution: "720P", promptExtend: false, watermark: false },
    media,
  });
  return { ...request, body: { ...request.body, parameters: { ...request.body.parameters, seed: input.seed } } };
}

/**
 * Alibaba Wan behind the `VideoProvider` interface. DashScope has no client idempotency key: the job loop's submit
 * attempt record (B4) is what prevents a second paid task after a crash. The provider task id is
 * `<modelId>|<DashScope task id>`, so a poll after a worker restart still knows the model's price.
 */
export function createAlibabaProvider(config: DashScopeConfig, fetcher: Fetch = fetch): VideoProvider {
  return {
    id: "alibaba",
    async submit(input) {
      const taskId = await dashscopeSubmit(config, alibabaRequest(input), fetcher);
      return { providerTaskId: `${input.modelId}|${taskId}` };
    },
    async poll(providerTaskId): Promise<ProviderPoll> {
      const separator = providerTaskId.lastIndexOf("|");
      const modelId = separator > 0 ? providerTaskId.slice(0, separator) : "";
      const task = await dashscopePoll(config, providerTaskId.slice(separator + 1), fetcher);
      if (task.status === "PENDING" || task.status === "RUNNING") return { state: "running" };
      if (task.status === "SUCCEEDED" && task.videoUrl) {
        const price = ALIBABA_USD_PER_VIDEO_SECOND[modelId] ?? Math.max(...Object.values(ALIBABA_USD_PER_VIDEO_SECOND));
        return {
          state: "succeeded",
          resultUrl: task.videoUrl,
          ...(task.billedSeconds !== undefined ? { costUsd: Math.round(task.billedSeconds * price * 10_000) / 10_000 } : {}),
        };
      }
      return { state: "failed", errorCode: `alibaba_${(task.code ?? task.status).toLowerCase()}` };
    },
  };
}

export function alibabaProviderFromEnv(env: NodeJS.ProcessEnv): VideoProvider | null {
  return env.DASHSCOPE_API_KEY && env.ALIBABA_WORKSPACE_ID
    ? createAlibabaProvider({ apiKey: env.DASHSCOPE_API_KEY, workspaceId: env.ALIBABA_WORKSPACE_ID })
    : null;
}
