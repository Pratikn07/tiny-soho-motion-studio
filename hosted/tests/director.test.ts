import { describe, expect, it, vi } from "vitest";

import {
  buildDirectorApprovalJobs,
  createDirectorDraft,
  validateDirectorProposal,
} from "@/lib/director";

const projectId = "11111111-1111-4111-8111-111111111111";
const ownedAssetId = "22222222-2222-4222-8222-222222222222";
const otherAssetId = "33333333-3333-4333-8333-333333333333";

describe("hosted Director contracts", () => {
  it("rejects a Director proposal that references an asset outside the owned project", () => {
    expect(() => validateDirectorProposal({
      projectId,
      title: "A calm product moment",
      shots: [{
        modelId: "wan2.7-t2v",
        prompt: "Soft natural light moves over the product.",
        media: [{ assetId: otherAssetId, role: "first_frame" }],
        options: {},
      }],
    }, {
      projectId,
      assets: [{ id: ownedAssetId, projectId }],
    })).toThrow(/owned project asset/i);
  });

  it("persists a queued Director request without creating a video job", async () => {
    const createDirectorRequest = vi.fn().mockResolvedValue({ id: "request-a", status: "queued" });
    const createJob = vi.fn();

    const repository = {
      getProject: vi.fn().mockResolvedValue({ id: projectId }),
      findDirectorRequestByIdempotency: vi.fn().mockResolvedValue(null),
      createDirectorRequest,
      createJob,
    };

    await expect(createDirectorDraft({
      projectId,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      brief: "Create a quiet five-second product motion study.",
    }, repository)).resolves.toMatchObject({ id: "request-a", status: "queued" });

    expect(createDirectorRequest).toHaveBeenCalledOnce();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("requires the current billing acknowledgement before deterministic child jobs are approved", () => {
    const snapshot = {
      projectId,
      title: "A calm product moment",
      shots: [{
        modelId: "wan2.7-t2v",
        prompt: "Soft natural light moves over the product.",
        media: [],
        options: {},
      }],
    };
    const scope = {
      projectId,
      assets: [{ id: ownedAssetId, projectId }],
      acknowledgements: [{ modelId: "wan2.7-t2v", contractVersion: "2026-09-20" }],
    };

    const first = buildDirectorApprovalJobs("55555555-5555-4555-8555-555555555555", snapshot, scope);
    const replay = buildDirectorApprovalJobs("55555555-5555-4555-8555-555555555555", snapshot, scope);
    expect(first[0].idempotencyKey).toBe(replay[0].idempotencyKey);
    expect(first[0].idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    expect(() => buildDirectorApprovalJobs("55555555-5555-4555-8555-555555555555", snapshot, {
      ...scope,
      acknowledgements: [],
    })).toThrow(/acknowledge/i);
  });
});
