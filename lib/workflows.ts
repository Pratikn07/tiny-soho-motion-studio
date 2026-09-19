import type { createStore } from "./store";

type Node = { id: string; type: string; data?: Record<string, unknown> };
type Graph = { nodes: Node[]; edges: { source: string; target: string }[] };
type State = { status: "running" | "completed" | "failed"; nodes: Record<string, { status: string; jobId?: string; outputAssetId?: string; error?: string }> };

export function validateWorkflow(graph: Graph) {
  if (!Array.isArray(graph.nodes) || graph.nodes.length > 100) throw new Error("Workflow must have at most 100 nodes.");
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length || graph.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error("Workflow has invalid node references.");
  const seen = new Set<string>(); const active = new Set<string>(); const next = new Map<string, string[]>(); graph.edges.forEach((edge) => next.set(edge.source, [...(next.get(edge.source) || []), edge.target]));
  const visit = (node: string): boolean => { if (active.has(node)) return true; if (seen.has(node)) return false; seen.add(node); active.add(node); const cycle = (next.get(node) || []).some(visit); active.delete(node); return cycle; };
  if (graph.nodes.some((node) => visit(node.id))) throw new Error("Workflow cannot contain a cycle.");
}

export function executeWorkflowRun(store: ReturnType<typeof createStore>, runId: string, eligibleModels: Set<string>) {
  const run = store.getWorkflowRun(runId); if (!run) throw new Error("Workflow run not found"); const graph = JSON.parse(run.graph) as Graph; validateWorkflow(graph); const state = JSON.parse(run.state) as State; const createdJobs: { id: string }[] = [];
  for (const node of graph.nodes) {
    const saved = state.nodes[node.id]; if (saved?.status === "completed" || saved?.jobId) continue;
    if (node.type === "generate-video" || node.type === "generate-image") {
      const data = node.data || {}; const modelId = String(data.modelId || ""); if (!eligibleModels.has(modelId)) { state.nodes[node.id] = { status: "failed", error: "Free Quota Only is not confirmed for this model." }; state.status = "failed"; continue; }
      const job = store.createJob({ projectId: run.projectId, idempotencyKey: `${run.id}:${node.id}`, modelId, task: node.type === "generate-image" ? "text-to-image" : "image-to-video", prompt: String(data.prompt || ""), inputAssetIds: Array.isArray(data.inputAssetIds) ? data.inputAssetIds as string[] : [], options: { ...(data.options as object || {}), inputRoles: Array.isArray(data.inputRoles) ? data.inputRoles : [] } });
      state.nodes[node.id] = { status: job.status, jobId: job.id }; createdJobs.push({ id: job.id }); continue;
    }
    state.nodes[node.id] = { status: "completed" };
  }
  for (const node of graph.nodes) { const nodeState = state.nodes[node.id]; if (!nodeState?.jobId) continue; const job = store.getJob(nodeState.jobId); if (job?.status === "completed") state.nodes[node.id] = { status: "completed", jobId: job.id, outputAssetId: job.outputAssetId || undefined }; else if (["failed", "needs_attention", "canceled"].includes(job?.status || "")) { state.nodes[node.id] = { status: "failed", jobId: job!.id, error: job!.error || job!.status }; state.status = "failed"; } }
  if (Object.values(state.nodes).length === graph.nodes.length && Object.values(state.nodes).every((node) => node.status === "completed")) state.status = "completed";
  store.updateWorkflowRun(runId, state); return { createdJobs, state };
}
