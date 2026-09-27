import { z } from "zod";
import { StudioError } from "./errors";
import type { Slide } from "../components/carousel/model";

export const regionSchema = z
  .object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
  })
  .refine(
    (r) => r.x + r.width <= 100.001 && r.y + r.height <= 100.001,
    "Area must fit inside the image.",
  );
export const snapshotSchema = z.object({
  sourceAssetId: z.string().uuid(),
  width: z.number().int().positive().max(12000),
  height: z.number().int().positive().max(12000),
  story: z.string().trim().min(1).max(3000),
  region: regionSchema,
  protectedRegions: z.array(regionSchema).max(50),
});
export const runSchema = z.object({
  id: z.string().uuid(),
  composeKey: z.string().uuid(),
  snapshot: snapshotSchema,
  jobId: z.string().uuid().optional(),
  composeJobId: z.string().uuid().optional(),
  outputAssetId: z.string().uuid().optional(),
});
export const savedSlideSchema = z
  .object({
    id: z.string().min(1).max(100),
    assetId: z.string().uuid(),
    name: z.string().min(1).max(255),
    width: z.number().int().positive().max(12000),
    height: z.number().int().positive().max(12000),
    origin: z.enum(["example", "upload"]),
    category: z.string().max(200),
    story: z.string().max(3000),
    selectedStory: z.string().max(100),
    region: regionSchema,
    protectedRegions: z.array(regionSchema).max(50),
    suggestions: z
      .array(
        z.object({
          id: z.string().max(100),
          title: z.string().max(150),
          prompt: z.string().max(3000),
        }),
      )
      .max(5),
    reviewed: z.boolean().default(false),
    analysisSummary: z.string().max(1200).optional(),
    run: runSchema.optional(),
  })
  .refine((s) => s.width * s.height <= 40_000_000, "Image too large.");
export const carouselDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slides: z.array(savedSlideSchema).max(20),
  })
  .refine(
    (d) => new Set(d.slides.map((s) => s.id)).size === d.slides.length,
    "Slide IDs must be unique.",
  );
export type CarouselDocument = z.infer<typeof carouselDocumentSchema>;
export type CarouselSnapshot = z.infer<typeof snapshotSchema>;
export type CarouselRun = z.infer<typeof runSchema>;
export type SavedSlide = z.infer<typeof savedSlideSchema>;
export type CarouselProject = {
  id: string;
  revision: number;
  document: CarouselDocument;
};
export function persistentSlide(slide: Slide): SavedSlide {
  return savedSlideSchema.parse(slide);
}
export function planSnapshot(
  slide: Pick<
    Slide,
    "assetId" | "width" | "height" | "story" | "region" | "protectedRegions"
  >,
): CarouselSnapshot {
  return snapshotSchema.parse({
    sourceAssetId: slide.assetId,
    width: slide.width,
    height: slide.height,
    story: slide.story,
    region: slide.region,
    protectedRegions: slide.protectedRegions,
  });
}
export function hasClearance(
  region: Slide["region"],
  protectedRegions: Slide["region"][],
  margin = 2,
) {
  return !protectedRegions.some(
    (p) =>
      region.x < p.x + p.width + margin &&
      region.x + region.width > p.x - margin &&
      region.y < p.y + p.height + margin &&
      region.y + region.height > p.y - margin,
  );
}
export function assertGenerationReady(
  slide: Pick<Slide, "story" | "reviewed" | "region" | "protectedRegions">,
) {
  if (!slide.story.trim())
    throw new StudioError(
      400,
      "story_required",
      "Write a story before generating.",
    );
  if (!slide.reviewed)
    throw new StudioError(
      400,
      "review_required",
      "Review the story, text and full movement before generating.",
    );
  if (!hasClearance(slide.region, slide.protectedRegions))
    throw new StudioError(
      400,
      "clearance_required",
      "Leave at least 2% space between the movement area and protected text.",
    );
}
export async function assertOwnedSlides(
  slides: SavedSlide[],
  projectId: string,
  getAsset: (
    id: string,
  ) => Promise<{
    project_id: string;
    kind: string;
    width: number | null;
    height: number | null;
  } | null>,
) {
  for (const slide of slides) {
    for (const ref of [
      { id: slide.assetId, width: slide.width, height: slide.height },
      ...(slide.run
        ? [
            {
              id: slide.run.snapshot.sourceAssetId,
              width: slide.run.snapshot.width,
              height: slide.run.snapshot.height,
            },
          ]
        : []),
    ]) {
      const asset = await getAsset(ref.id);
      if (
        !asset ||
        asset.project_id !== projectId ||
        asset.kind !== "source-image"
      )
        throw new StudioError(
          400,
          "invalid_carousel_asset",
          "Every slide must use an owned source image in this project.",
        );
      if (asset.width !== ref.width || asset.height !== ref.height)
        throw new StudioError(
          400,
          "invalid_carousel_dimensions",
          "Slide dimensions must match its source image dimensions.",
        );
    }
  }
}
export function generationPrompt(snapshot: CarouselSnapshot) {
  const r = snapshot.region;
  return `${snapshot.story}\nSingle continuous five-second shot at natural speed. Locked camera, no zoom, pan or reframing. Preserve identity, scene and composition. Confine the entire action, including hair and hands, inside the image area from ${r.x}% left, ${r.y}% top to ${r.x + r.width}% left, ${r.y + r.height}% top. Leave breathing room from its edges. Keep all writing, logos and objects outside that area still. No slow motion. No new characters. Silent.`;
}

export function compositorAvailable(
  capabilities: Array<{
    capability_id: string;
    status: string;
    refreshed_at: string;
  }>,
  now = Date.now(),
) {
  return capabilities.some(
    (c) =>
      c.capability_id === "carousel_compose" &&
      c.status === "available" &&
      Number.isFinite(Date.parse(c.refreshed_at)) &&
      now - Date.parse(c.refreshed_at) >= -60_000 &&
      now - Date.parse(c.refreshed_at) < 300_000,
  );
}
