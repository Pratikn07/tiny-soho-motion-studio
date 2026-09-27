import { workspaceBaseUrl, configPresent } from "./config";
import { getModel } from "./models";
import { serializeAlibabaJob } from "./providers/serializers";
import type { ResolvedProviderMedia } from "./media-transport/resolve";

const auth = () => ({ Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` });
const json = async (response: Response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || body.code || `Provider request failed (${response.status})`); return body; };

export async function submitAlibabaJob(job: { modelId: string; task: string; prompt: string; inputAssetIds: string; options: string }, inputs: ResolvedProviderMedia[]) {
  if (!configPresent()) throw new Error("Alibaba credentials are not configured. Run npm run setup.");
  const model = getModel(job.modelId);
  const serialized = serializeAlibabaJob(job, inputs);
  const response = await fetch(`${workspaceBaseUrl()}${serialized.path}`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json", ...(serialized.async ? { "X-DashScope-Async": "enable" } : {}), ...(serialized.requiresOssResourceResolve ? { "X-DashScope-OssResourceResolve": "enable" } : {}) }, body: JSON.stringify(serialized.body), signal: AbortSignal.timeout(serialized.timeoutMs) });
  const body = await json(response);
  if (model.media === "image") {
    const url = body.output?.choices?.[0]?.message?.content?.find((item: any) => item.image)?.image || body.output?.results?.[0]?.url;
    if (!url) throw new Error("Image provider response did not include an output URL.");
    return { providerTaskId: null, outputUrl: url, usage: body.usage || null };
  }
  const taskId = body.output?.task_id;
  if (!taskId) throw new Error("Video provider response did not include a task ID.");
  return { providerTaskId: taskId, outputUrl: null, usage: body.usage || null };
}

export async function checkAlibabaTask(taskId: string) {
  const response = await fetch(`${workspaceBaseUrl()}/tasks/${encodeURIComponent(taskId)}`, { headers: auth(), signal: AbortSignal.timeout(30_000) });
  const body = await json(response);
  return { status: body.output?.task_status as string, outputUrl: body.output?.video_url as string | undefined, error: body.output?.message || body.output?.code, usage: body.usage || null };
}
