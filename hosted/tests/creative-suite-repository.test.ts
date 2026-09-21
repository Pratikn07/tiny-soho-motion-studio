import { describe, expect, it, vi } from "vitest";

import { StudioRepository } from "@/lib/repository";

describe("hosted Creative Suite repository ownership", () => {
  it("assigns the authenticated owner when creating a Director request", async () => {
    const insert = vi.fn();
    const single = vi.fn().mockResolvedValue({
      data: { id: "request-a", owner_user_id: "owner-a", project_id: "project-a", status: "queued" },
      error: null,
    });
    const query = {
      insert: insert.mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );

    await repository.createDirectorRequest({
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      fingerprint: "a".repeat(64),
      brief: "Create a calm five-second product motion clip.",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_user_id: "owner-a",
      project_id: "22222222-2222-4222-8222-222222222222",
      status: "queued",
    }));
  });

  it("stores an immutable workflow graph snapshot with the authenticated owner", async () => {
    const insert = vi.fn();
    const single = vi.fn().mockResolvedValue({
      data: { id: "run-a", owner_user_id: "owner-a", project_id: "project-a", status: "queued" },
      error: null,
    });
    const query = {
      insert: insert.mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );
    const graphSnapshot = { version: 2, nodes: [], edges: [] };

    await repository.createWorkflowRun({
      id: "11111111-1111-4111-8111-111111111111",
      workflowId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      graphSnapshot,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_user_id: "owner-a",
      project_id: "33333333-3333-4333-8333-333333333333",
      graph_snapshot: graphSnapshot,
      node_state: {},
      status: "queued",
    }));
  });

  it("assigns the authenticated owner when creating a Vision job", async () => {
    const insert = vi.fn();
    const single = vi.fn().mockResolvedValue({
      data: { id: "vision-a", owner_user_id: "owner-a", project_id: "project-a", status: "queued" },
      error: null,
    });
    const query = {
      insert: insert.mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );

    await repository.createVisionJob({
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      sourceAssetId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      operation: "overlay",
      options: { regions: [] },
      inputAssetIds: [],
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_user_id: "owner-a",
      project_id: "22222222-2222-4222-8222-222222222222",
      source_asset_id: "33333333-3333-4333-8333-333333333333",
      operation: "overlay",
      status: "queued",
    }));
  });

  it("filters a Vision job read by the authenticated owner", async () => {
    const eq = vi.fn();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: eq.mockReturnThis(),
      maybeSingle,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );

    await expect(repository.getVisionJob("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();

    expect(eq).toHaveBeenCalledWith("id", "11111111-1111-4111-8111-111111111111");
    expect(eq).toHaveBeenCalledWith("owner_user_id", "owner-a");
  });
});
