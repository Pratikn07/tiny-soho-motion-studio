import { describe, expect, it, vi } from "vitest";

import { advanceWorkflowRun, type WorkflowGraph } from "../src/workflows.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const parentJobId = "33333333-3333-4333-8333-333333333333";
const outputAssetId = "44444444-4444-4444-8444-444444444444";

const graph: WorkflowGraph = {
  version: 2,
  nodes: [
    { id: "parent", type: "generate-video", data: { modelId: "wan2.7-i2v", contractVersion: "2026-09-20", task: "image-to-video", prompt: "Parent clip" } },
    { id: "shot", type: "generate-video", data: { modelId: "wan2.7-i2v", contractVersion: "2026-09-20", task: "image-to-video", prompt: "Child clip" } },
  ],
  edges: [{ source: "parent", sourceOutput: "output", target: "shot", targetInput: "media:first_frame" }],
};

describe("Creative workflow worker", () => {
  it("waits for a parent video job before creating its child", async () => {
    const createVideoJob = vi.fn();
    const result = await advanceWorkflowRun({
      id: runId,
      project_id: projectId,
      owner_user_id: "owner-a",
      graph_snapshot: graph,
      node_state: { parent: { status: "queued", jobId: parentJobId } },
    }, {
      getVideoJob: vi.fn().mockResolvedValue({ id: parentJobId, status: "submitted", output_asset_id: null }),
      getAsset: vi.fn().mockResolvedValue({ id: outputAssetId, project_id: projectId, owner_user_id: "owner-a" }),
      hasModelAcknowledgement: vi.fn().mockResolvedValue(true),
      createVideoJob,
      createVisionJob: vi.fn(),
      getVisionJob: vi.fn(),
      capabilities: [],
    });

    expect(result.nodeState.shot).toMatchObject({ status: "pending" });
    expect(createVideoJob).not.toHaveBeenCalled();
  });

  it("uses a deterministic run and node idempotency key for each child job", async () => {
    const createVideoJob = vi.fn().mockResolvedValue({ id: "child-job", status: "queued", output_asset_id: null });

    await advanceWorkflowRun({
      id: runId,
      project_id: projectId,
      owner_user_id: "owner-a",
      graph_snapshot: graph,
      node_state: { parent: { status: "completed", outputAssetId } },
    }, {
      getVideoJob: vi.fn(),
      getAsset: vi.fn().mockResolvedValue({ id: outputAssetId, project_id: projectId, owner_user_id: "owner-a" }),
      hasModelAcknowledgement: vi.fn().mockResolvedValue(true),
      createVideoJob,
      createVisionJob: vi.fn(),
      getVisionJob: vi.fn(),
      capabilities: [],
    });

    expect(createVideoJob).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
  });
});
