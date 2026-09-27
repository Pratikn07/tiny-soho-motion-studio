import { beforeEach, describe, it, expect, vi } from "vitest";
import { GET, PUT } from "@/app/api/carousel/[id]/route";
import { POST as generate } from "@/app/api/carousel/[id]/generate/route";
import { POST as compose } from "@/app/api/carousel/[id]/compose/route";
import { POST as jobPost } from "@/app/api/jobs/route";
import { POST as visionPost } from "@/app/api/vision/jobs/route";
import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { generationPrompt, planSnapshot } from "@/lib/carousel";
const repo = vi.hoisted(() => ({
  getProject: vi.fn(),
  getAsset: vi.fn(),
  saveCarousel: vi.fn(),
  listVisionCapabilities: vi.fn(),
  findJobByIdempotency: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createServiceSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/repository", () => ({
  StudioRepository: class {
    constructor() {
      Object.assign(this, repo);
    }
  },
}));
vi.mock("@/app/api/jobs/route", () => ({
  POST: vi.fn(async () =>
    Response.json({ job: { id: "job", status: "queued" } }),
  ),
}));
vi.mock("@/app/api/vision/jobs/route", () => ({
  POST: vi.fn(async () =>
    Response.json({ job: { id: "compose", status: "queued" } }),
  ),
}));
const pid = "11111111-1111-4111-8111-111111111111",
  aid = "22222222-2222-4222-8222-222222222222",
  rid = "33333333-3333-4333-8333-333333333333";
const slide = {
  id: "slide",
  assetId: aid,
  width: 1122,
  height: 1402,
  name: "Recipe",
  origin: "upload" as const,
  category: "Food",
  story: "Lift a bite.",
  selectedStory: "",
  region: { x: 35, y: 35, width: 55, height: 40 },
  protectedRegions: [{ x: 0, y: 0, width: 100, height: 25 }],
  suggestions: [],
  reviewed: true,
};
const withRun = () => ({
  ...slide,
  run: {
    id: rid,
    composeKey: "44444444-4444-4444-8444-444444444444",
    snapshot: planSnapshot(slide),
  },
});
const context = { params: Promise.resolve({ id: pid }) };
const request = (body: unknown) =>
  new Request(`https://studio.test/api/carousel/${pid}`, {
    method: "POST",
    headers: { Authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({
    userId: "owner",
    email: "owner@test",
  });
  repo.getProject.mockResolvedValue({
    id: pid,
    carousel_revision: 0,
    carousel_document: { name: "Test", slides: [withRun()] },
  });
  repo.listVisionCapabilities.mockResolvedValue([
    {
      capability_id: "carousel_compose",
      status: "available",
      refreshed_at: new Date().toISOString(),
    },
  ]);
});
describe("Carousel owner-gated routes", () => {
  it("rejects unauthenticated reads before touching the database", async () => {
    vi.mocked(requireOwner).mockRejectedValue(
      new StudioError(401, "denied", "Sign in."),
    );
    expect((await GET(request({}), context)).status).toBe(401);
    expect(repo.getProject).not.toHaveBeenCalled();
  });
  it("rejects foreign source references on save", async () => {
    repo.getAsset.mockResolvedValue(null);
    expect(
      (
        await PUT(
          request({ revision: 0, document: { name: "Test", slides: [slide] } }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(repo.saveCarousel).not.toHaveBeenCalled();
  });
  it("prevents paid submission until compositor is available", async () => {
    repo.listVisionCapabilities.mockResolvedValue([]);
    expect(
      (await generate(request({ slideId: "slide", runId: rid }), context))
        .status,
    ).toBe(503);
    expect(jobPost).not.toHaveBeenCalled();
  });
  it("rejects an old compositor heartbeat before generation", async () => {
    repo.listVisionCapabilities.mockResolvedValue([
      {
        capability_id: "carousel_compose",
        status: "available",
        refreshed_at: "2020-01-01T00:00:00Z",
      },
    ]);
    expect(
      (await generate(request({ slideId: "slide", runId: rid }), context))
        .status,
    ).toBe(503);
    expect(jobPost).not.toHaveBeenCalled();
  });
  it("submits the saved plan using its original idempotency key on each retry", async () => {
    for (let i = 0; i < 2; i++)
      expect(
        (await generate(request({ slideId: "slide", runId: rid }), context))
          .status,
      ).toBe(200);
    const calls = await Promise.all(
      vi.mocked(jobPost).mock.calls.map(async ([r]) => (r as Request).json()),
    );
    expect(
      calls.every((c) => c.idempotencyKey === rid && c.options.duration === 5),
    ).toBe(true);
  });
  it("does not compose a result against an altered snapshot", async () => {
    repo.findJobByIdempotency.mockResolvedValue({
      status: "completed",
      output_asset_id: aid,
      input_assets: [{ role: "first_frame", assetId: aid }],
      prompt: "different plan",
    });
    expect(
      (await compose(request({ slideId: "slide", runId: rid }), context))
        .status,
    ).toBe(409);
    expect(visionPost).not.toHaveBeenCalled();
  });
  it("finishes from the immutable source snapshot with a stable composition key", async () => {
    repo.findJobByIdempotency.mockResolvedValue({
      status: "completed",
      output_asset_id: aid,
      input_assets: [{ role: "first_frame", assetId: aid }],
      prompt: generationPrompt(planSnapshot(slide)),
    });
    expect(
      (await compose(request({ slideId: "slide", runId: rid }), context))
        .status,
    ).toBe(200);
    const input = await vi.mocked(visionPost).mock.calls[0][0].json();
    expect(input.options.carousel.width).toBe(1122);
    expect(input.inputAssetIds).toEqual([aid]);
    expect(input.idempotencyKey).toBe(withRun().run.composeKey);
  });
});
