import { workspaceBaseUrl, configPresent } from "./config";
import { getModel } from "./models";

const auth = () => ({ Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` });
const json = async (response: Response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || body.code || `Provider request failed (${response.status})`); return body; };
const asDataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

export async function submitAlibabaJob(job: { modelId: string; task: string; prompt: string; inputAssetIds: string; options: string }, inputs: { mime: string; bytes: Buffer; role: string }[]) {
  if (!configPresent()) throw new Error("Alibaba credentials are not configured. Run npm run setup.");
  const model = getModel(job.modelId);
  const options = JSON.parse(job.options) as Record<string, unknown>;
  if (model.media === "image") {
    const content: Record<string, string>[] = [{ text: job.prompt }];
    for (const input of inputs) content.push({ image: asDataUrl(input.mime, input.bytes) });
    const response = await fetch(`${workspaceBaseUrl()}/services/aigc/multimodal-generation/generation`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ model: model.providerModel, input: { messages: [{ role: "user", content }] }, parameters: options }), signal: AbortSignal.timeout(120_000) });
    const body = await json(response);
    const url = body.output?.choices?.[0]?.message?.content?.find((item: any) => item.image)?.image || body.output?.results?.[0]?.url;
    if (!url) throw new Error("Image provider response did not include an output URL.");
    return { providerTaskId: null, outputUrl: url, usage: body.usage || null };
  }
  const media = inputs.map((input) => ({ type: input.role === "source-image" ? "first_frame" : input.role.replace(/-/g, "_"), url: asDataUrl(input.mime, input.bytes) }));
  const response = await fetch(`${workspaceBaseUrl()}/services/aigc/video-generation/video-synthesis`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json", "X-DashScope-Async": "enable" }, body: JSON.stringify({ model: model.providerModel, input: { prompt: job.prompt, media }, parameters: { resolution: options.resolution || "720P", duration: options.duration || 5, prompt_extend: options.promptExtend ?? true, watermark: options.watermark ?? false } }), signal: AbortSignal.timeout(60_000) });
  const body = await json(response);
  const taskId = body.output?.task_id;
  if (!taskId) throw new Error("Video provider response did not include a task ID.");
  return { providerTaskId: taskId, outputUrl: null, usage: body.usage || null };
}

export async function checkAlibabaTask(taskId: string) {
  const response = await fetch(`${workspaceBaseUrl()}/tasks/${encodeURIComponent(taskId)}`, { headers: auth(), signal: AbortSignal.timeout(30_000) });
  const body = await json(response);
  return { status: body.output?.task_status as string, outputUrl: body.output?.video_url as string | undefined, error: body.output?.message || body.output?.code, usage: body.usage || null };
}
