import { z } from "zod";

export type DirectorRequestStatus = "queued" | "running" | "drafted" | "failed" | "needs_attention" | "canceled";

export type StudioDirectorRequest = {
  id: string;
  project_id: string;
  owner_user_id: string;
  idempotency_key: string;
  fingerprint: string;
  brief: string;
  status: DirectorRequestStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioDirectorProposal = {
  id: string;
  request_id: string;
  project_id: string;
  owner_user_id: string;
  snapshot: Record<string, unknown>;
  evidence: Record<string, unknown>;
  fingerprint: string;
  status: "drafted" | "approved" | "failed" | "canceled";
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioWorkflowRun = {
  id: string;
  workflow_id: string;
  project_id: string;
  owner_user_id: string;
  idempotency_key: string;
  fingerprint: string;
  graph_snapshot: Record<string, unknown>;
  node_state: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "needs_attention" | "canceled";
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioWorkflow = {
  id: string;
  project_id: string | null;
  owner_user_id: string;
  name: string;
  graph_version: 2;
  graph: Record<string, unknown>;
  fingerprint: string;
  created_at: string;
};

export type StudioVisionCapability = {
  capability_id: string;
  service_version: string;
  status: "available" | "unavailable";
  reason: string | null;
  refreshed_at: string;
  updated_at: string;
};

export const visionOperationSchema = z.enum([
  "inspect", "overlay", "plate", "compose", "ocr", "segment", "layers",
]);

export type VisionOperation = z.infer<typeof visionOperationSchema>;

export const visionJobStatusSchema = z.enum([
  "queued", "running", "completed", "failed", "needs_attention", "canceled",
]);

export type VisionJobStatus = z.infer<typeof visionJobStatusSchema>;

export type StudioVisionJob = {
  id: string;
  project_id: string;
  owner_user_id: string;
  source_asset_id: string;
  idempotency_key: string;
  fingerprint: string;
  operation: VisionOperation;
  options: Record<string, unknown>;
  input_asset_ids: string[];
  output_asset_ids: string[];
  status: VisionJobStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export const createVisionJobSchema = z.object({
  projectId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  operation: visionOperationSchema,
  options: z.record(z.unknown()).default({}),
  inputAssetIds: z.array(z.string().uuid()).max(10).default([]),
  idempotencyKey: z.string().uuid(),
});
