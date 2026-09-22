import { describe, expect, it, vi } from "vitest";

import { processDirectorRequest, runDirectorWorkerTick } from "../src/director.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const ownerUserId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";

describe("Creative Director worker", () => {
  it("ignores Supabase's all-null response when no Director request is queued", async () => {
    const from = vi.fn();

    await expect(runDirectorWorkerTick({
      rpc: vi.fn().mockResolvedValue({ data: { id: null }, error: null }),
      from,
    }, {
      apiKey: "test-key",
      workspaceId: "workspace",
    })).resolves.toBe(false);

    expect(from).not.toHaveBeenCalled();
  });

  it("submits Qwen only after a queued Director request has been claimed and never queues video", async () => {
    const submitQwen = vi.fn().mockResolvedValue({
      title: "A calm product moment",
      shots: [{
        modelId: "wan2.7-t2v",
        prompt: "Soft natural light moves over the product.",
        media: [],
        options: {},
      }],
    });
    const createVideoJobs = vi.fn();
    const saveProposal = vi.fn();
    const updateRequest = vi.fn();

    await expect(processDirectorRequest({
      id: "44444444-4444-4444-8444-444444444444",
      project_id: projectId,
      owner_user_id: ownerUserId,
      brief: "Create a quiet five-second product motion study.",
      status: "running",
      worker_lease_id: "55555555-5555-4555-8555-555555555555",
    }, {
      listProjectAssets: vi.fn().mockResolvedValue([{
        id: assetId,
        project_id: projectId,
        owner_user_id: ownerUserId,
        name: "product.png",
        kind: "source-image",
        mime_type: "image/png",
        width: 1080,
        height: 1920,
        duration_seconds: null,
        created_at: "2026-09-20T00:00:00.000Z",
      }]),
      submitQwen,
      saveProposal,
      updateRequest,
      createVideoJobs,
    })).resolves.toMatchObject({ status: "drafted" });

    expect(submitQwen).toHaveBeenCalledOnce();
    expect(saveProposal).toHaveBeenCalledOnce();
    expect(createVideoJobs).not.toHaveBeenCalled();
    expect(updateRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "drafted" }));
  });
});
