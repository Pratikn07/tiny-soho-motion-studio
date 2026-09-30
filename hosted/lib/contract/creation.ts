import { z } from "zod";

export const MAX_SLIDES = 20;
export const MAX_IMAGE_SIDE = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

/** `creative_studio_assets.kind` for each uploaded layer. The text layer is PNG only. */
export const LAYER_ASSET_KINDS = { background: "background-image", text: "text-layer" } as const;
export const LAYER_MIME_TYPES = {
  background: ["image/jpeg", "image/png", "image/webp"],
  text: ["image/png"],
} as const;
export const layerAssetKindSchema = z.enum([LAYER_ASSET_KINDS.background, LAYER_ASSET_KINDS.text]);
export type LayerAssetKind = z.infer<typeof layerAssetKindSchema>;

export const MOTION_STYLES = ["calm", "lively"] as const;
export const motionStyleSchema = z.enum(MOTION_STYLES);
export type MotionStyle = z.infer<typeof motionStyleSchema>;

/** End-frame strength for each motion style (playbook, step 5). */
export const END_FRAME_STRENGTH: Readonly<Record<MotionStyle, number>> = {
  calm: 0.6,
  lively: 0.4,
};

export const TEXT_ANIMATION_STYLES = ["none", "fade", "fade-rise"] as const;

export const textAnimationSchema = z.object({
  style: z.enum(TEXT_ANIMATION_STYLES),
  firstAt: z.number().min(0).max(4.5),
  step: z.number().min(0).max(2),
  fade: z.number().min(0).max(2),
  rise: z.number().min(0).max(200),
  coverFrame: z.enum(["first", "last"]),
});
export type TextAnimation = z.infer<typeof textAnimationSchema>;

export const DEFAULT_TEXT_ANIMATION: TextAnimation = {
  style: "fade-rise",
  firstAt: 0.2,
  step: 0.14,
  fade: 0.35,
  rise: 18,
  coverFrame: "last",
};

export const UPLOAD_CHECK_CODES = [
  "size_mismatch",
  "no_alpha",
  "text_not_solid",
  "text_haze",
  "ratio_unsupported",
  "too_large",
  "background_has_text",
] as const;
export const uploadCheckCodeSchema = z.enum(UPLOAD_CHECK_CODES);
export type UploadCheckCode = z.infer<typeof uploadCheckCodeSchema>;

const multipleOf64 = z.number().int().positive().multipleOf(64);

export const uploadCheckResultSchema = z
  .object({
    ok: z.boolean(),
    items: z
      .array(
        z.object({
          code: uploadCheckCodeSchema,
          severity: z.enum(["error", "warning", "info"]),
          message: z.string().trim().min(1).max(500),
        }),
      )
      .max(20),
    textLayer: z
      .object({
        solidPercent: z.number().min(0).max(100),
        partialPercent: z.number().min(0).max(100),
        hazePercent: z.number().min(0).max(100),
        lines: z.number().int().min(0).max(200),
      })
      .optional(),
    generationSize: z
      .object({ width: multipleOf64, height: multipleOf64 })
      .optional(),
  })
  .refine(
    (result) => result.ok === !result.items.some((item) => item.severity === "error"),
    "ok must be false exactly when an item has severity error.",
  );
export type UploadCheckResult = z.infer<typeof uploadCheckResultSchema>;

export const slideMotionSchema = z
  .object({
    source: z.enum(["suggestion", "creator"]),
    suggestionIndex: z.number().int().min(0).max(2).optional(),
    story: z.string().trim().min(1).max(1000),
    prompt: z.string().trim().min(1).max(5000),
    motionStyle: motionStyleSchema.optional(),
  })
  .refine(
    (motion) => (motion.source === "suggestion") === (motion.suggestionIndex !== undefined),
    "suggestionIndex is required for a suggestion and not allowed for the creator's own idea.",
  );
export type SlideMotion = z.infer<typeof slideMotionSchema>;

const dimension = z.number().int().positive().max(MAX_IMAGE_SIDE);

export const slideV2Schema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    order: z.number().int().min(0).max(MAX_SLIDES - 1),
    width: dimension.nullable(),
    height: dimension.nullable(),
    layers: z.object({
      backgroundAssetId: z.string().uuid().nullable(),
      textAssetId: z.string().uuid().nullable(),
    }),
    checks: uploadCheckResultSchema.optional(),
    reviewRunId: z.string().uuid().optional(),
    motion: slideMotionSchema.optional(),
    modelId: z.string().trim().min(1).max(120).optional(),
    textAnimation: textAnimationSchema.optional(),
    latestRunId: z.string().uuid().optional(),
    chosenTakeId: z.string().uuid().optional(),
  })
  .refine(
    (slide) => (slide.width === null) === (slide.height === null),
    "width and height are set together.",
  )
  .refine(
    (slide) => slide.layers.backgroundAssetId === null || slide.width !== null,
    "A slide with a background has its pixel size.",
  )
  .refine(
    (slide) => slide.layers.textAssetId === null || slide.layers.backgroundAssetId !== null,
    "A text layer needs a background layer.",
  )
  .refine(
    (slide) => slide.width === null || slide.height === null || slide.width * slide.height <= MAX_IMAGE_PIXELS,
    "Image too large.",
  );
export type SlideV2 = z.infer<typeof slideV2Schema>;

export const creationDocumentV2Schema = z
  .object({
    version: z.literal(2),
    name: z.string().trim().min(1).max(160),
    defaults: z.object({
      modelId: z.string().trim().min(1).max(120),
      motionStyle: motionStyleSchema,
      textAnimation: textAnimationSchema,
    }),
    slides: z.array(slideV2Schema).max(MAX_SLIDES),
  })
  .refine(
    (document) => new Set(document.slides.map((slide) => slide.id)).size === document.slides.length,
    "Slide IDs must be unique.",
  )
  .refine(
    (document) => new Set(document.slides.map((slide) => slide.order)).size === document.slides.length,
    "Slide order values must be unique.",
  );
export type CreationDocumentV2 = z.infer<typeof creationDocumentV2Schema>;
