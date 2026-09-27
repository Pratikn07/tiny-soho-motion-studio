import { describe, expect, it } from "vitest";
import {
  exampleSlides,
  exportPlan,
  imageDimensionsValid,
  intersects,
  moveSlide,
  normalizeRegion,
  updateSlide,
  validateImage,
} from "../app/carousel/model";

describe("Carousel Studio drafts", () => {
  it("preserves unusual source dimensions in plans instead of coercing to a preset", () => {
    const slide = exampleSlides()[0];
    const plan = exportPlan(slide);
    expect(plan.source).toMatchObject({
      width: 1129,
      height: 1393,
      aspectRatio: 1129 / 1393,
    });
    expect(plan.status).toBe("draft-not-generated");
    expect(plan.generatedVideo).toBeNull();
  });
  it("keeps a slide edit independent and protects fixture originals", () => {
    const slides = exampleSlides();
    const edited = updateSlide(slides, slides[1].id, { story: "My action" });
    expect(edited[1].story).toBe("My action");
    expect(edited[0]).toBe(slides[0]);
    expect(slides[1].story).not.toBe("My action");
    expect(exampleSlides()[1].story).toBe(slides[1].story);
  });
  it("bounds moving regions, including non-finite input and excessive resize", () => {
    expect(normalizeRegion({ x: -2, y: 95, width: 30, height: 20 })).toEqual({
      x: 0,
      y: 80,
      width: 30,
      height: 20,
    });
    expect(
      normalizeRegion({ x: NaN, y: Infinity, width: 200, height: -5 }),
    ).toEqual({ x: 0, y: 0, width: 100, height: 5 });
  });
  it("detects text collisions but permits adjacent regions", () => {
    const text = { x: 0, y: 0, width: 100, height: 40 };
    expect(intersects(text, { x: 20, y: 39, width: 20, height: 30 })).toBe(
      true,
    );
    expect(intersects(text, { x: 20, y: 40, width: 20, height: 30 })).toBe(
      false,
    );
    for (const slide of exampleSlides())
      expect(
        slide.protectedRegions.some((r) => intersects(slide.region, r)),
      ).toBe(false);
  });
  it("reorders without changing slide identity or wrapping across ends", () => {
    const slides = exampleSlides();
    expect(moveSlide(slides, slides[0].id, -1)).toBe(slides);
    expect(moveSlide(slides, slides[2].id, 1)).toBe(slides);
    expect(moveSlide(slides, slides[1].id, -1).map((s) => s.id)).toEqual([
      "meal-prep",
      "understanding",
      "salmon-cakes",
    ]);
  });
  it("rejects unsupported, empty, oversized and extreme images", () => {
    expect(
      validateImage({ type: "image/svg+xml", size: 100, name: "a.svg" }),
    ).toContain("PNG, JPG or WebP");
    expect(
      validateImage({ type: "image/png", size: 0, name: "empty.png" }),
    ).toContain("empty");
    expect(
      validateImage({
        type: "image/jpeg",
        size: 26 * 1024 * 1024,
        name: "large.jpg",
      }),
    ).toContain("25 MB");
    expect(
      validateImage({ type: "image/webp", size: 100, name: "ok.webp" }),
    ).toBeNull();
    expect(imageDimensionsValid(0, 100)).toBe(false);
    expect(imageDimensionsValid(9000, 9000)).toBe(false);
    expect(imageDimensionsValid(1080, 1920)).toBe(true);
  });
  it("attaches the real sample only to its matching image", () => {
    expect(
      exampleSlides()
        .filter((s) => s.video)
        .map((s) => s.id),
    ).toEqual(["meal-prep"]);
  });
});
