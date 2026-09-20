import { normalizeMediaRole, type MediaRole } from "./models";
import { queueGeneration, type GenerationMedia } from "./generation";
import type { createStore } from "./store";

type Node = { id: string; type: string; data?: Record<string, unknown> };
type Edge = { source: string; target: string; sourcePort?: string; targetPort?: string; targetRole?: MediaRole };
type Graph = { version: 2; nodes: Node[]; edges: Edge[] };
type NodeState = { status: "queued" | "completed" | "failed" | "pending"; jobId?: string; outputAssetId?: string; outputs?: Record<string, string>; error?: string };
type State = { status: "running" | "completed" | "failed"; nodes: Record<string, NodeState> };

export function normalizeWorkflow(graph: { version?: unknown; nodes?: unknown; edges?: unknown }): Graph {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("Workflow nodes and edges are required.");
  return {
    version: 2,
    nodes: graph.nodes as Node[],
    edges: (graph.edges as Edge[]).map((edge) => ({
      ...edge,
      sourcePort: edge.sourcePort || "asset",
      targetPort: edge.targetPort || (edge.targetRole ? `media:${edge.targetRole}` : undefined),
    })),
  };
}

export function validateWorkflow(input: { version?: unknown; nodes?: unknown; edges?: unknown }) {
  const graph = normalizeWorkflow(input);
  if (!Array.isArray(graph.nodes) || graph.nodes.length > 100) throw new Error("Workflow must have at most 100 nodes.");
  if (!Array.isArray(graph.edges)) throw new Error("Workflow edges are required.");
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length || graph.nodes.some((node) => !node.id) || graph.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) throw new Error("Workflow has invalid node references.");
  const seen = new Set<string>(); const active = new Set<string>(); const next = new Map<string, string[]>(); graph.edges.forEach((edge) => next.set(edge.source, [...(next.get(edge.source) || []), edge.target]));
  const visit = (node: string): boolean => { if (active.has(node)) return true; if (seen.has(node)) return false; seen.add(node); active.add(node); const cycle = (next.get(node) || []).some(visit); active.delete(node); return cycle; };
  if (graph.nodes.some((node) => visit(node.id))) throw new Error("Workflow cannot contain a cycle.");
  for (const edge of graph.edges) if (!edge.targetPort?.startsWith("media:")) throw new Error("Workflow asset edges require a named media target port.");
  for (const edge of graph.edges) normalizeMediaRole(edge.targetPort!.slice("media:".length));
  return graph;
}

const mediaFromData = (data: Record<string, unknown>) => {
  if (Array.isArray(data.media)) return data.media.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as { assetId?: unknown }).assetId !== "string" || typeof (item as { role?: unknown }).role !== "string") throw new Error("Workflow media must include an asset and role.");
    return { assetId: (item as { assetId: string }).assetId, role: normalizeMediaRole((item as { role: string }).role) };
  });
  const assetIds = Array.isArray(data.inputAssetIds) ? data.inputAssetIds : []; const roles = Array.isArray(data.inputRoles) ? data.inputRoles : [];
  if (assetIds.length !== roles.length) throw new Error("Workflow input assets need matching roles.");
  return assetIds.map((assetId, index) => {
    if (typeof assetId !== "string" || typeof roles[index] !== "string") throw new Error("Workflow input assets need matching roles.");
    return { assetId, role: normalizeMediaRole(roles[index]) };
  });
};

function refreshJobs(store: ReturnType<typeof createStore>, state: State) {
  for (const node of Object.values(state.nodes)) {
    if (!node.jobId || node.status === "completed" || node.status === "failed") continue;
    const job = store.getJob(node.jobId);
    if (job?.status === "completed") { node.status = "completed"; node.outputAssetId = job.outputAssetId || undefined; if (job.outputAssetId) node.outputs = { output: job.outputAssetId }; }
    else if (["failed", "needs_attention", "canceled"].includes(job?.status || "")) { node.status = "failed"; node.error = job?.error || job?.status; }
  }
}

export function executeWorkflowRun(store: ReturnType<typeof createStore>, runId: string, eligibleModels: Set<string>) {
  const run = store.getWorkflowRun(runId); if (!run) throw new Error("Workflow run not found"); const graph = validateWorkflow(JSON.parse(run.graph) as Graph); const state = JSON.parse(run.state) as State; const createdJobs: { id: string }[] = [];
  refreshJobs(store, state);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const node of graph.nodes) {
      const saved = state.nodes[node.id]; if (saved) continue;
      const incoming = graph.edges.filter((edge) => edge.target === node.id); const parents = incoming.map((edge) => state.nodes[edge.source]);
      if (parents.some((parent) => parent?.status === "failed")) { state.nodes[node.id] = { status: "failed", error: "An upstream workflow node failed." }; progressed = true; continue; }
      if (parents.some((parent) => parent?.status !== "completed")) continue;
      const data = node.data || {};
      try {
        if (node.type === "asset") {
          const assetId = typeof data.assetId === "string" ? data.assetId : ""; const asset = assetId ? store.getAsset(assetId) : null;
          if (!asset) throw new Error("Asset nodes require a local asset.");
          if (asset.projectId && asset.projectId !== run.projectId) throw new Error("Asset nodes must use an asset from the run project.");
          state.nodes[node.id] = { status: "completed", outputAssetId: asset.id, outputs: { asset: asset.id } };
        } else if (node.type === "prompt-template" || node.type === "noop") {
          state.nodes[node.id] = { status: "completed" };
        } else if (node.type === "generate-video" || node.type === "generate-image") {
          const media: GenerationMedia[] = mediaFromData(data);
          for (const edge of incoming) {
            const source = state.nodes[edge.source];
            const sourceAssetId = source?.outputs?.[edge.sourcePort || "asset"] || source?.outputAssetId;
            if (!sourceAssetId) throw new Error(`Workflow source port ${edge.sourcePort || "asset"} has no completed asset.`);
            if (!edge.targetPort?.startsWith("media:")) throw new Error("Workflow asset edges require a named media target port.");
            media.push({ assetId: sourceAssetId, role: normalizeMediaRole(edge.targetPort.slice("media:".length)) });
          }
          const job = queueGeneration(store, { projectId: run.projectId, idempotencyKey: `${run.id}:${node.id}`, modelId: String(data.modelId || ""), prompt: String(data.prompt || ""), media, options: (data.options as Record<string, unknown> | undefined) || {} }, eligibleModels);
          state.nodes[node.id] = { status: job.status === "completed" ? "completed" : "queued", jobId: job.id, outputAssetId: job.outputAssetId || undefined }; createdJobs.push({ id: job.id });
        } else {
          state.nodes[node.id] = { status: "pending", error: `${node.type} requires an executor before this workflow can complete.` };
        }
      } catch (error) {
        state.nodes[node.id] = { status: "failed", error: error instanceof Error ? error.message : "Workflow node failed." };
      }
      progressed = true;
    }
  }
  if (Object.values(state.nodes).some((node) => node.status === "failed")) state.status = "failed";
  else if (graph.nodes.every((node) => state.nodes[node.id]?.status === "completed")) state.status = "completed";
  else state.status = "running";
  store.updateWorkflowRun(runId, state); return { createdJobs, state };
}
