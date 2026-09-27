import { describe, it, expect, vi } from "vitest";
import {
  carouselDocumentSchema,
  assertOwnedSlides,
  assertGenerationReady,
  assertExportDimensions,
  planSnapshot,
  persistentSlide,
} from "@/lib/carousel";
import { StudioRepository } from "@/lib/repository";
const id = "11111111-1111-4111-8111-111111111111";
export const slide = {
  id,
  assetId: id,
  name: "Food",
  width: 1122,
  height: 1402,
  origin: "upload" as const,
  category: "Food",
  story: "A fork lifts a bite.",
  selectedStory: "",
  region: { x: 35, y: 30, width: 55, height: 40 },
  protectedRegions: [{ x: 0, y: 0, width: 100, height: 25 }],
  suggestions: [],
  reviewed: true,
};
describe("Carousel document persistence and review", () => {
  it("stores durable IDs, never blob or signed URLs", () => {
    const result = persistentSlide({
      ...slide,
      src: "blob:private",
      video: "https://private?token=secret",
    });
    expect(JSON.stringify(result)).not.toMatch(/blob:|token=|https:/);
    expect(
      carouselDocumentSchema.parse({ name: "My project", slides: [result] })
        .slides[0].assetId,
    ).toBe(id);
  });
  it("rejects wrong project or mismatched source dimensions", async () => {
    const getAsset = vi.fn().mockResolvedValue({
      id,
      project_id: "another",
      kind: "source-image",
      width: 1122,
      height: 1402,
    });
    await expect(
      assertOwnedSlides([slide], "project", getAsset),
    ).rejects.toThrow(/project/);
    getAsset.mockResolvedValue({
      id,
      project_id: "project",
      kind: "source-image",
      width: 600,
      height: 800,
    });
    await expect(
      assertOwnedSlides([slide], "project", getAsset),
    ).rejects.toThrow(/dimensions/);
    getAsset.mockResolvedValue({
      id,
      project_id: "project",
      kind: "source-image",
      width: 1122,
      height: 1402,
    });
    await expect(
      assertOwnedSlides([slide], "project", getAsset),
    ).resolves.toBeUndefined();
  });
  it("requires review, text clearance and a meaningful story", () => {
    expect(() => assertGenerationReady(slide)).not.toThrow();
    expect(() => assertGenerationReady({ ...slide, reviewed: false })).toThrow(
      /review/i,
    );
    expect(() =>
      assertGenerationReady({
        ...slide,
        region: { x: 35, y: 25.5, width: 55, height: 40 },
      }),
    ).toThrow(/space|clearance/i);
    expect(() => assertGenerationReady({ ...slide, story: "" })).toThrow(
      /story/i,
    );
    expect(planSnapshot(slide)).toEqual(
      expect.objectContaining({ sourceAssetId: id, width: 1122, height: 1402 }),
    );
  });
  it("rejects invalid rectangles, duplicate slide IDs and oversize documents", () => {
    expect(
      carouselDocumentSchema.safeParse({
        name: "Test",
        slides: [{ ...slide, region: { x: 80, y: 0, width: 40, height: 50 } }],
      }).success,
    ).toBe(false);
    expect(
      carouselDocumentSchema.safeParse({ name: "Test", slides: [slide, slide] })
        .success,
    ).toBe(false);
  });
  it("conditionally saves the authenticated project revision", async () => {
    const q: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const repo = new StudioRepository(
      { from: vi.fn().mockReturnValue(q) },
      { userId: "owner", email: "owner@test.com" },
    );
    await expect(
      repo.saveCarousel("project", 3, { name: "Test", slides: [slide] }),
    ).rejects.toThrow(/another tab|changed/i);
    expect(q.eq).toHaveBeenCalledWith("owner_user_id", "owner");
    expect(q.eq).toHaveBeenCalledWith("carousel_revision", 3);
  });
  it("rejects oversized exact-ratio exports before a provider request", () => {
    expect(() => assertExportDimensions(1129, 1393)).not.toThrow();
    expect(() => assertExportDimensions(4001, 4001)).toThrow(/smaller image/);
  });
});
