import { configPresent, workspaceBaseUrl } from "./config";
import { listModels } from "./models";

export function draftProposal(prompt: string, projectId: string) {
  const motion = /transition|between/i.test(prompt) ? "between-slide-transition" : "slide-animation";
  return { version: 1, projectId, title: "Tiny Soho motion draft", motionMode: motion, shots: [{ prompt: prompt.slice(0, 1000), modelId: "alibaba:wan3-video", duration: 5, resolution: "720P", inputAssetIds: [], inputRoles: [] }], note: "Draft only. Approval is required before generation." };
}

export async function askDirector(prompt: string, projectId: string) {
  if (!configPresent()) return draftProposal(prompt, projectId);
  const system = "You are Tiny Soho Director. Return concise JSON only with title, motionMode, shots[{prompt,modelId,duration,resolution}], note. You may draft; never claim a job was submitted.";
  const response = await fetch(`${workspaceBaseUrl().replace(/\/api\/v1$/, "/compatible-mode/v1")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "qwen-plus", messages: [{ role: "system", content: system }, { role: "user", content: `${prompt}\nAvailable models: ${listModels().map((model) => model.id).join(", ")}` }], response_format: { type: "json_object" } }), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) return draftProposal(prompt, projectId);
  const body = await response.json();
  try { return JSON.parse(body.choices?.[0]?.message?.content || "{}"); } catch { return draftProposal(prompt, projectId); }
}
