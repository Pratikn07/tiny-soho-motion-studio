import { StudioError } from "@/lib/errors";
import { getHostedModel, type HostedModelId } from "@/lib/models";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ProviderMedia = {
  role: "start-image" | "end-image";
  mimeType: string;
  bytes: Buffer;
};

export type ProviderOptions = {
  duration: number;
  resolution: string;
  aspectRatio?: string;
};

export type ProviderConfig = {
  apiKey: string;
  workspaceId: string;
  fetcher?: Fetcher;
};

const workspaceUrl = (workspaceId: string) => (
  `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1`
);

const asDataUrl = (media: ProviderMedia) => (
  `data:${media.mimeType};base64,${media.bytes.toString("base64")}`
);

const providerError = (response: Response, body: unknown): never => {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code.slice(0, 80) : "provider_request_failed";
  const message = typeof record.message === "string" ? record.message.slice(0, 240) : "Video provider request failed.";
  throw new StudioError(502, `alibaba_${code}`, message);
};

const parseBody = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) providerError(response, body);
  return body as Record<string, any>;
};

export async function submitWanJob(
  input: { modelId: HostedModelId; prompt: string; options: ProviderOptions },
  media: ProviderMedia[],
  config: ProviderConfig,
) {
  const model = getHostedModel(input.modelId);
  if (!model) throw new StudioError(400, "unsupported_model", "Choose a supported model.");
  const fetcher = config.fetcher ?? fetch;
  const parameters: Record<string, unknown> = {
    resolution: input.options.resolution,
    duration: input.options.duration,
    prompt_extend: true,
    watermark: false,
  };
  if (model.aspectRatios) parameters.ratio = input.options.aspectRatio;

  const response = await fetcher(`${workspaceUrl(config.workspaceId)}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: model.providerModel,
      input: {
        prompt: input.prompt,
        media: media.map((item) => ({
          type: item.role === "start-image" ? "first_frame" : "last_frame",
          url: asDataUrl(item),
        })),
      },
      parameters,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await parseBody(response);
  const providerTaskId = body.output?.task_id;
  if (typeof providerTaskId !== "string" || !providerTaskId) {
    throw new StudioError(502, "provider_missing_task_id", "Video provider did not return a task ID.");
  }
  return { providerTaskId };
}

export async function checkWanTask(taskId: string, config: ProviderConfig): Promise<{
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
  outputUrl?: string;
}> {
  const fetcher = config.fetcher ?? fetch;
  const response = await fetcher(`${workspaceUrl(config.workspaceId)}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await parseBody(response);
  const candidate = String(body.output?.task_status ?? "UNKNOWN").toUpperCase();
  const status = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"].includes(candidate)
    ? candidate as "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"
    : "UNKNOWN";
  const outputUrl = typeof body.output?.video_url === "string" ? body.output.video_url : undefined;
  return { status, ...(outputUrl ? { outputUrl } : {}) };
}
