import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/carousel/route";
import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";

const repo = vi.hoisted(() => ({ listCarouselProjects: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/repository", () => ({
  StudioRepository: class { constructor() { Object.assign(this, repo); } },
}));

const request = () => new Request("https://studio.test/api/carousel");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner", email: "owner@test" });
});

describe("carousel creation history", () => {
  it("checks owner access before reading any projects", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new StudioError(401, "denied", "Sign in."));
    expect((await GET(request())).status).toBe(401);
    expect(repo.listCarouselProjects).not.toHaveBeenCalled();
  });

  it("returns minimal ordered summaries without media or provider fields", async () => {
    repo.listCarouselProjects.mockResolvedValue([
      { id: "new", name: "Meal prep", updated_at: "2026-09-29T12:00:00.000Z",
        carousel_document: { name: "Meal prep", slides: [{}, {}] }, secret: "never-return" },
      { id: "old", name: "Salmon cakes", updated_at: "2026-09-28T12:00:00.000Z",
        carousel_document: { name: "Salmon cakes", slides: [{}] } },
    ]);

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ creations: [
      { id: "new", name: "Meal prep", updatedAt: "2026-09-29T12:00:00.000Z", slideCount: 2 },
      { id: "old", name: "Salmon cakes", updatedAt: "2026-09-28T12:00:00.000Z", slideCount: 1 },
    ] });
  });
});
