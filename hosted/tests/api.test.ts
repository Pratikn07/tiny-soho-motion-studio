import { describe, expect, it, vi } from "vitest";
import { createStudioApi } from "@/lib/api";

describe("hosted Studio browser API", () => {
  it("forwards the fresh Supabase access token to the same-origin project route", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    const api = createStudioApi({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "session-token" } } }) },
    } as never, fetcher);

    await expect(api.listProjects()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("/api/projects", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer session-token" }),
    }));
  });

  it("normalizes server project and asset fields before the motion view receives them", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projects: [{
          id: "project-1",
          name: "Summer launch",
          canvas: "9:16",
          free_quota_models: ["wan2.7-i2v"],
          free_quota_confirmed_at: { "wan2.7-i2v": "2026-09-20T12:00:00.000Z" },
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        assets: [{
          id: "asset-1",
          project_id: "project-1",
          kind: "source-image",
          name: "frame.png",
          mime_type: "image/png",
          byte_size: 123,
        }],
      }), { status: 200 }));
    const api = createStudioApi({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "session-token" } } }) },
    } as never, fetcher);

    await expect(api.listProjects()).resolves.toEqual([{
      id: "project-1",
      name: "Summer launch",
      canvas: "9:16",
      freeQuotaModels: ["wan2.7-i2v"],
      freeQuotaConfirmedAt: { "wan2.7-i2v": "2026-09-20T12:00:00.000Z" },
    }]);
    await expect(api.listAssets("project-1")).resolves.toEqual([{
      id: "asset-1",
      kind: "source-image",
      name: "frame.png",
      mimeType: "image/png",
    }]);
  });
});
