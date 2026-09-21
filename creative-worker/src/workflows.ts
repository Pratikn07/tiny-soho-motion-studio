import { createHash } from "node:crypto";

type WorkflowNodeType =
  | "asset" | "prompt-template" | "noop" | "generate-video"
  | "inspect" | "overlay" | "plate" | "compose" | "ocr" | "segment" | "layers";

type WorkflowNode = { id: string; type: WorkflowNodeType; data: Record<string, unknown> };
type WorkflowEdge = { source: string; sourceOutput: string; target: string; targetInput: string };
export type WorkflowGraph = { version: 2; nodes: WorkflowNode[]; edges: WorkflowEdge[] };

type NodeStatus = "pending" | "queued" | "completed" | "failed" | "needs_attention";
type WorkflowNodeState = {
  status: NodeStatus;
  jobId?: string;
  outputAssetId?: string;
  outputs?: Record<string, { assetId: string }>;
  error?: string;
};

export type WorkflowRun = {
  id: string;
  project_id: string;
  owner_user_id: string;
  graph_snapshot: WorkflowGraph;
  node_state: Record<string, WorkflowNodeState>;
};

type JobRecord = { id: string; status: string; output_asset_id: string | null };
type AssetRecord = { id: string; project_id: string; owner_user_id: string };
type Capability = { capabilityId: string; status: "available" | "unavailable" };

type WorkflowDependencies = {
  getVideoJob: (jobId: string) => Promise<JobRecord | null>;
  getVisionJob: (jobId: string) => Promise<JobRecord | null>;
  getAsset: (assetId: string) => Promise<AssetRecord | null>;
  hasModelAcknowledgement: (input: { ownerUserId: string; modelId: string; contractVersion: string }) => Promise<boolean>;
  createVideoJob: (input: {
    projectId: string;
    ownerUserId: string;
    idempotencyKey: string;
    fingerprint: string;
    modelId: string;
    task: string;
    prompt: string;
    media: Array<{ assetId: string; role: string; ordinal: number }>;
    options: Record<string, unknown>;
  }) => Promise<JobRecord>;
  createVisionJob: (input: {
    projectId: string;
    ownerUserId: string;
    idempotencyKey: string;
    operation: string;
    sourceAssetId: string;
    inputAssetIds: string[];
    options: Record<string, unknown>;
  }) => Promise<JobRecord>;
  capabilities: readonly Capability[];
};

const terminalFailures = new Set(["failed", "needs_attention", "canceled"]);
const visionNodeTypes = new Set<WorkflowNodeType>(["inspect", "overlay", "plate", "compose", "ocr", "segment", "layers"]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export function deterministicWorkflowJobKey(runId: string, nodeId: string) {
  const hash = createHash("sha256").update(`${runId}:${nodeId}`).digest("hex");
  const variant = (Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80;
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant.toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

const dataMedia = (data: Record<string, unknown>) => {
  if (!Array.isArray(data.media)) return [];
  return data.media.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.assetId !== "string" || typeof raw.role !== "string") {
      throw new Error("workflow_media_invalid");
    }
    const ordinal = raw.ordinal === undefined ? index + 1 : raw.ordinal;
    if (!Number.isInteger(ordinal) || (ordinal as number) <= 0) throw new Error("workflow_media_order_invalid");
    return { assetId: raw.assetId, role: raw.role, ordinal: ordinal as number };
  });
};

const outputFor = (state: WorkflowNodeState, port: string) => (
  state.outputs?.[port]?.assetId
  ?? (port === "asset" || port === "output" || port === "raw-video" ? state.outputAssetId : undefined)
);

const successfulOutput = (job: JobRecord) => (
  job.output_asset_id ? {
    status: "completed" as const,
    outputAssetId: job.output_asset_id,
    outputs: { output: { assetId: job.output_asset_id }, "raw-video": { assetId: job.output_asset_id } },
  } : { status: "needs_attention" as const, error: "Workflow job completed without a durable output asset." }
);

const refreshQueuedNodes = async (state: Record<string, WorkflowNodeState>, dependencies: WorkflowDependencies) => {
  for (const node of Object.values(state)) {
    if (node.status !== "queued" || !node.jobId) continue;
    const job = await dependencies.getVideoJob(node.jobId) ?? await dependencies.getVisionJob(node.jobId);
    if (!job) continue;
    if (job.status === "completed") Object.assign(node, successfulOutput(job));
    else if (terminalFailures.has(job.status)) Object.assign(node, { status: "failed", error: "An upstream workflow job did not complete." });
  }
};

const assertOwnedAsset = async (assetId: string, run: WorkflowRun, dependencies: WorkflowDependencies) => {
  const asset = await dependencies.getAsset(assetId);
  if (!asset || asset.project_id !== run.project_id || asset.owner_user_id !== run.owner_user_id) {
    throw new Error("workflow_asset_not_owned");
  }
  return asset;
};

const resolveIncomingMedia = async (
  node: WorkflowNode,
  graph: WorkflowGraph,
  state: Record<string, WorkflowNodeState>,
  run: WorkflowRun,
  dependencies: WorkflowDependencies,
) => {
  const media = dataMedia(node.data);
  for (const mediaItem of media) await assertOwnedAsset(mediaItem.assetId, run, dependencies);
  const incoming = graph.edges.filter((edge) => edge.target === node.id);
  for (const edge of incoming) {
    const source = state[edge.source];
    const assetId = source ? outputFor(source, edge.sourceOutput) : undefined;
    if (!assetId || !edge.targetInput.startsWith("media:")) throw new Error("workflow_source_output_missing");
    await assertOwnedAsset(assetId, run, dependencies);
    media.push({ assetId, role: edge.targetInput.slice("media:".length), ordinal: media.length + 1 });
  }
  return media;
};

const overallStatus = (graph: WorkflowGraph, state: Record<string, WorkflowNodeState>) => {
  const statuses = Object.values(state).map((node) => node.status);
  if (statuses.includes("failed")) return "failed" as const;
  if (statuses.includes("needs_attention")) return "needs_attention" as const;
  if (graph.nodes.every((node) => state[node.id]?.status === "completed")) return "completed" as const;
  return "running" as const;
};

export async function advanceWorkflowRun(run: WorkflowRun, dependencies: WorkflowDependencies) {
  const graph = run.graph_snapshot;
  const nodeState = structuredClone(run.node_state);
  await refreshQueuedNodes(nodeState, dependencies);

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const node of graph.nodes) {
      const existing = nodeState[node.id];
      if (existing && existing.status !== "pending") continue;
      const incoming = graph.edges.filter((edge) => edge.target === node.id);
      const parents = incoming.map((edge) => nodeState[edge.source]);
      if (parents.some((parent) => parent?.status === "failed" || parent?.status === "needs_attention")) {
        nodeState[node.id] = { status: "failed", error: "An upstream workflow node failed." };
        progressed = true;
        continue;
      }
      if (parents.some((parent) => !parent || parent.status !== "completed")) {
        nodeState[node.id] = { status: "pending" };
        continue;
      }

      try {
        if (node.type === "asset") {
          const assetId = typeof node.data.assetId === "string" ? node.data.assetId : "";
          await assertOwnedAsset(assetId, run, dependencies);
          nodeState[node.id] = { status: "completed", outputAssetId: assetId, outputs: { asset: { assetId } } };
        } else if (node.type === "prompt-template" || node.type === "noop") {
          nodeState[node.id] = { status: "completed" };
        } else if (node.type === "generate-video") {
          const modelId = typeof node.data.modelId === "string" ? node.data.modelId : "";
          const contractVersion = typeof node.data.contractVersion === "string" ? node.data.contractVersion : "";
          const task = typeof node.data.task === "string" ? node.data.task : "";
          const prompt = typeof node.data.prompt === "string" ? node.data.prompt : "";
          if (!modelId || !contractVersion || !task || !prompt) throw new Error("workflow_generation_invalid");
          if (!await dependencies.hasModelAcknowledgement({ ownerUserId: run.owner_user_id, modelId, contractVersion })) {
            nodeState[node.id] = { status: "needs_attention", error: "A current billing acknowledgement is required for this workflow model." };
            progressed = true;
            continue;
          }
          const media = await resolveIncomingMedia(node, graph, nodeState, run, dependencies);
          const idempotencyKey = deterministicWorkflowJobKey(run.id, node.id);
          const job = await dependencies.createVideoJob({
            projectId: run.project_id,
            ownerUserId: run.owner_user_id,
            idempotencyKey,
            fingerprint: createHash("sha256").update(canonicalJson({ modelId, contractVersion, task, prompt, media, options: node.data.options ?? {} })).digest("hex"),
            modelId,
            task,
            prompt,
            media,
            options: isRecord(node.data.options) ? node.data.options : {},
          });
          nodeState[node.id] = job.status === "completed" ? successfulOutput(job) : { status: "queued", jobId: job.id };
        } else if (visionNodeTypes.has(node.type)) {
          if (!dependencies.capabilities.some((capability) => capability.capabilityId === node.type && capability.status === "available")) {
            nodeState[node.id] = { status: "needs_attention", error: `${node.type} is unavailable in the hosted Vision service.` };
            progressed = true;
            continue;
          }
          const sourceEdge = incoming[0];
          const sourceAssetId = sourceEdge ? outputFor(nodeState[sourceEdge.source], sourceEdge.sourceOutput) : undefined;
          if (!sourceAssetId) throw new Error("workflow_vision_source_missing");
          await assertOwnedAsset(sourceAssetId, run, dependencies);
          const job = await dependencies.createVisionJob({
            projectId: run.project_id,
            ownerUserId: run.owner_user_id,
            idempotencyKey: deterministicWorkflowJobKey(run.id, node.id),
            operation: node.type,
            sourceAssetId,
            inputAssetIds: [],
            options: isRecord(node.data.options) ? node.data.options : {},
          });
          nodeState[node.id] = job.status === "completed" ? successfulOutput(job) : { status: "queued", jobId: job.id };
        }
        progressed = true;
      } catch {
        nodeState[node.id] = { status: "failed", error: "Workflow node could not be prepared." };
        progressed = true;
      }
    }
  }
  return { status: overallStatus(graph, nodeState), nodeState };
}

type WorkflowClient = {
  rpc: (fn: string) => any;
  from: (table: string) => any;
};

const workflowJob = (row: any): JobRecord => ({
  id: row.id,
  status: row.status,
  output_asset_id: row.output_asset_id ?? row.output_asset_ids?.[0] ?? null,
});

export async function runWorkflowWorkerTick(client: WorkflowClient) {
  const claimed = await client.rpc("claim_creative_studio_workflow_run");
  if (claimed.error) throw new Error("workflow_run_claim_failed");
  if (!claimed.data) return false;
  const run = claimed.data as WorkflowRun & { worker_lease_id: string | null };
  const capabilities = await client
    .from("creative_studio_vision_capabilities")
    .select("capability_id,status");
  if (capabilities.error) throw new Error("workflow_capability_read_failed");

  const result = await advanceWorkflowRun(run, {
    getVideoJob: async (jobId) => {
      const response = await client
        .from("creative_studio_jobs")
        .select("id,status,output_asset_id")
        .eq("id", jobId)
        .eq("owner_user_id", run.owner_user_id)
        .maybeSingle();
      if (response.error) throw new Error("workflow_video_job_read_failed");
      return response.data ? workflowJob(response.data) : null;
    },
    getVisionJob: async (jobId) => {
      const response = await client
        .from("creative_studio_vision_jobs")
        .select("id,status,output_asset_ids")
        .eq("id", jobId)
        .eq("owner_user_id", run.owner_user_id)
        .maybeSingle();
      if (response.error) throw new Error("workflow_vision_job_read_failed");
      return response.data ? workflowJob(response.data) : null;
    },
    getAsset: async (assetId) => {
      const response = await client
        .from("creative_studio_assets")
        .select("id,project_id,owner_user_id")
        .eq("id", assetId)
        .eq("owner_user_id", run.owner_user_id)
        .maybeSingle();
      if (response.error) throw new Error("workflow_asset_read_failed");
      return response.data ?? null;
    },
    hasModelAcknowledgement: async ({ ownerUserId, modelId, contractVersion }) => {
      const response = await client
        .from("creative_studio_model_acknowledgements")
        .select("id")
        .eq("owner_user_id", ownerUserId)
        .eq("model_id", modelId)
        .eq("contract_version", contractVersion)
        .maybeSingle();
      if (response.error) throw new Error("workflow_model_acknowledgement_read_failed");
      return Boolean(response.data);
    },
    createVideoJob: async (input) => {
      const existing = await client
        .from("creative_studio_jobs")
        .select("id,status,output_asset_id,fingerprint")
        .eq("project_id", input.projectId)
        .eq("owner_user_id", input.ownerUserId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.error) throw new Error("workflow_video_job_read_failed");
      if (existing.data) {
        if (existing.data.fingerprint !== input.fingerprint) throw new Error("workflow_video_job_idempotency_conflict");
        return workflowJob(existing.data);
      }
      const created = await client.from("creative_studio_jobs").insert({
        project_id: input.projectId,
        owner_user_id: input.ownerUserId,
        idempotency_key: input.idempotencyKey,
        fingerprint: input.fingerprint,
        model_id: input.modelId,
        task: input.task,
        prompt: input.prompt,
        input_assets: input.media.map(({ assetId, role, ordinal }) => ({ assetId, role, ordinal })),
        options: input.options,
        status: "submitting",
      }).select("id,status,output_asset_id").single();
      if (created.error || !created.data) throw new Error("workflow_video_job_create_failed");
      try {
        for (const media of input.media) {
          const inserted = await client.from("creative_studio_job_media").insert({
            job_id: created.data.id,
            asset_id: media.assetId,
            owner_user_id: input.ownerUserId,
            role: media.role,
            ordinal: media.ordinal,
          });
          if (inserted.error) throw new Error("workflow_video_media_create_failed");
        }
        const queued = await client
          .from("creative_studio_jobs")
          .update({ status: "queued", updated_at: new Date().toISOString() })
          .eq("id", created.data.id)
          .eq("status", "submitting")
          .select("id,status,output_asset_id")
          .maybeSingle();
        if (queued.error || !queued.data) throw new Error("workflow_video_job_queue_failed");
        return workflowJob(queued.data);
      } catch (error) {
        await client.from("creative_studio_jobs").update({
          status: "needs_attention",
          error_code: "workflow_media_persistence_failed",
          error_message: "Workflow inputs need review before provider submission.",
          updated_at: new Date().toISOString(),
        }).eq("id", created.data.id);
        throw error;
      }
    },
    createVisionJob: async (input) => {
      const existing = await client
        .from("creative_studio_vision_jobs")
        .select("id,status,output_asset_ids")
        .eq("project_id", input.projectId)
        .eq("owner_user_id", input.ownerUserId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.error) throw new Error("workflow_vision_job_read_failed");
      if (existing.data) return workflowJob(existing.data);
      const created = await client.from("creative_studio_vision_jobs").insert({
        project_id: input.projectId,
        owner_user_id: input.ownerUserId,
        source_asset_id: input.sourceAssetId,
        idempotency_key: input.idempotencyKey,
        operation: input.operation,
        options: input.options,
        input_asset_ids: input.inputAssetIds,
        output_asset_ids: [],
        status: "queued",
      }).select("id,status,output_asset_ids").single();
      if (created.error || !created.data) throw new Error("workflow_vision_job_create_failed");
      return workflowJob(created.data);
    },
    capabilities: (capabilities.data ?? []).map((capability: { capability_id: string; status: "available" | "unavailable" }) => ({
      capabilityId: capability.capability_id,
      status: capability.status,
    })),
  });

  const terminal = ["completed", "failed", "needs_attention"].includes(result.status);
  const updated = await client
    .from("creative_studio_workflow_runs")
    .update({
      status: result.status,
      node_state: result.nodeState,
      next_run_at: new Date(Date.now() + (terminal ? 24 * 60 * 60 * 1000 : 15_000)).toISOString(),
      worker_lease_id: null,
      worker_lease_expires_at: null,
      error_code: result.status === "needs_attention" ? "workflow_needs_attention" : null,
      error_message: result.status === "needs_attention" ? "Workflow requires review before it can continue." : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("worker_lease_id", run.worker_lease_id);
  if (updated.error) throw new Error("workflow_run_update_failed");
  return true;
}
