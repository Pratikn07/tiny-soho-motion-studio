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
});
