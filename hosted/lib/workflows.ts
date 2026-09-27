import { z } from "zod";

import { StudioError } from "@/lib/errors";
import {
  getVideoModelContract,
  preflightVideoGeneration,
  type GenerationMedia,
  type MediaRole,
} from "@/lib/video-catalog";

export type WorkflowNodeType =
  | "asset"
  | "prompt-template"
  | "noop"
  | "generate-video"
  | "inspect"
  | "overlay"
  | "plate"
  | "compose"
  | "ocr"
  | "segment"
  | "layers";

export type WorkflowGraphV2 = {
  version: 2;
  nodes: Array<{ id: string; type: WorkflowNodeType; data: Record<string, unknown> }>;
  edges: Array<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
};

export type VisionCapabilitySnapshot = {
  capabilityId: string;
  status: "available" | "unavailable";
};

const mediaRoleSchema = z.enum([
  "first_frame", "last_frame", "mask_image", "reference_image", "reference_video",
  "source_video", "driving_video", "driving_audio", "first_clip",
]);

const workflowNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum([
    "asset", "prompt-template", "noop", "generate-video",
    "inspect", "overlay", "plate", "compose", "ocr", "segment", "layers",
  ]),
  data: z.record(z.unknown()).default({}),
}).strict();

const workflowEdgeSchema = z.object({
  source: z.string().trim().min(1).max(120),
  sourceOutput: z.string().trim().min(1).max(120),
  target: z.string().trim().min(1).max(120),
  targetInput: z.string().trim().min(1).max(120),
}).strict();

const workflowGraphSchema = z.object({
  version: z.literal(2),
  nodes: z.array(workflowNodeSchema).min(1).max(100),
  edges: z.array(workflowEdgeSchema).max(300),
}).strict();

const staticMediaSchema = z.array(z.object({
  assetId: z.string().uuid(),
  role: mediaRoleSchema,
  ordinal: z.number().int().positive().optional(),
}).strict()).max(20);

const visionNodeTypes = new Set<WorkflowNodeType>([
  "inspect", "overlay", "plate", "compose", "ocr", "segment", "layers",
]);

const mediaRoles = new Set<MediaRole>([
  "first_frame", "last_frame", "mask_image", "reference_image", "reference_video",
  "source_video", "driving_video", "driving_audio", "first_clip",
]);

const invalid = (code: string, message: string): never => {
  throw new StudioError(400, code, message);
};

const nodeOutputPorts = (node: WorkflowGraphV2["nodes"][number]) => {
  if (node.type === "asset") {
    const outputs = node.data.outputs;
    if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) return Object.keys(outputs);
    return ["asset"];
  }
  if (node.type === "prompt-template" || node.type === "noop") return ["output"];
  if (node.type === "generate-video") return ["output", "raw-video"];
  if (node.type === "inspect") return ["regions"];
  if (node.type === "overlay") return ["overlay"];
  if (node.type === "plate") return ["plate", "overlay"];
  if (node.type === "compose") return ["final-video"];
  if (node.type === "ocr") return ["regions"];
  if (node.type === "segment") return ["mask"];
  return ["layers"];
};

const inputAllowed = (node: WorkflowGraphV2["nodes"][number], targetInput: string) => {
  if (node.type === "generate-video") {
    return targetInput.startsWith("media:") && mediaRoles.has(targetInput.slice("media:".length) as MediaRole);
  }
  const visionInputs: Partial<Record<WorkflowNodeType, readonly string[]>> = {
    inspect: ["image"],
    overlay: ["image", "regions"],
    plate: ["image", "regions", "mask", "layers"],
    compose: ["raw-video", "overlay"],
    ocr: ["image"],
    segment: ["image", "regions", "points", "negative-points", "box"],
    layers: ["image"],
  };
  return visionInputs[node.type]?.includes(targetInput) ?? false;
};

const cyclic = (graph: WorkflowGraphV2) => {
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const seen = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    active.add(id);
    const result = (next.get(id) ?? []).some(visit);
    active.delete(id);
    return result;
  };
  return graph.nodes.some((node) => visit(node.id));
};

const staticMediaFor = (node: WorkflowGraphV2["nodes"][number]) => {
  const parsed = staticMediaSchema.safeParse(node.data.media ?? []);
  if (!parsed.success) return invalid("invalid_workflow_media", "Workflow media must use owned asset IDs and supported roles.");
  return parsed.data;
};

export function validateWorkflowGraph(value: unknown, capabilities: readonly VisionCapabilitySnapshot[]): WorkflowGraphV2 {
  const parsed = workflowGraphSchema.safeParse(value);
  if (!parsed.success) return invalid("invalid_workflow_graph", "Workflow graph must use the current V2 format.");
  const graph: WorkflowGraphV2 = parsed.data;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== graph.nodes.length) invalid("workflow_duplicate_node", "Workflow node IDs must be unique.");
  if (graph.edges.some((edge) => !nodesById.has(edge.source) || !nodesById.has(edge.target))) {
    invalid("workflow_node_missing", "Workflow edges must connect saved nodes.");
  }
  if (cyclic(graph)) invalid("workflow_cycle", "Workflow cannot contain a cycle.");

  const capabilityById = new Map(capabilities.map((capability) => [capability.capabilityId, capability.status]));
  for (const node of graph.nodes) {
    if (visionNodeTypes.has(node.type) && capabilityById.get(node.type) !== "available") {
      invalid("workflow_vision_unavailable", `${node.type} is unavailable in the hosted Vision service.`);
    }
  }
  for (const edge of graph.edges) {
    const source = nodesById.get(edge.source)!;
    const target = nodesById.get(edge.target)!;
    if (!nodeOutputPorts(source).includes(edge.sourceOutput)) {
      invalid("workflow_source_port_invalid", `Workflow output ${edge.sourceOutput} is not declared by ${source.id}.`);
    }
    if (!inputAllowed(target, edge.targetInput)) {
      invalid("workflow_target_port_invalid", `Workflow input ${edge.targetInput} is not declared by ${target.id}.`);
    }
  }

  const nodes = graph.nodes.map((node) => {
    if (node.type !== "generate-video") return node;
    const modelId = typeof node.data.modelId === "string" ? node.data.modelId : "";
    const prompt = typeof node.data.prompt === "string" ? node.data.prompt : "";
    const contract = getVideoModelContract(modelId);
    if (!contract) return invalid("unsupported_model", "Workflow selects a model outside the Studio catalogue.");
    const staticMedia = staticMediaFor(node);
    const connectedMedia: GenerationMedia[] = graph.edges
      .filter((edge) => edge.target === node.id)
      .map((edge, index) => ({
        assetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        role: edge.targetInput.slice("media:".length) as MediaRole,
        ordinal: staticMedia.length + index + 1,
      }));
    const prepared = preflightVideoGeneration({
      modelId,
      prompt,
      media: [...staticMedia, ...connectedMedia],
      options: node.data.options ?? {},
      acknowledgements: [{ modelId: contract.id, contractVersion: contract.contractVersion }],
    });
    return {
      ...node,
      data: {
        ...node.data,
        media: staticMedia,
        modelId: prepared.contract.id,
        task: prepared.contract.task,
        contractVersion: prepared.contract.contractVersion,
        options: prepared.options,
      },
    };
  });
  return { ...graph, nodes };
}
