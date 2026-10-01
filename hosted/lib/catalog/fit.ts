import type { CatalogModel, CatalogModelView, SlideV2 } from "@/lib/contract";

/**
 * Whether a model can make this slide. `ok: false` greys the model out; `ok: true` with a reason is a warning the
 * creator should read before choosing it.
 */
export function fitForSlide(model: CatalogModel, slide: SlideV2): NonNullable<CatalogModelView["fit"]> {
  if (!slide.layers.backgroundAssetId || slide.width === null || slide.height === null) {
    return { ok: false, reason: "Upload this slide's background first." };
  }
  if (slide.checks && !slide.checks.ok) {
    return { ok: false, reason: "Fix the upload problems on this slide first." };
  }
  if (model.supports.sizes === "multiple-of-64" && slide.checks && !slide.checks.generationSize) {
    return { ok: false, reason: "This slide's size has not been checked yet." };
  }
  if (!model.supports.endFrame && slide.layers.textAssetId) {
    return { ok: true, reason: "Cannot hold the last frame in place, so the child may walk into your text." };
  }
  if (!model.calibrated) {
    return { ok: true, reason: "Not yet tested on your slides; automatic checks may be less reliable." };
  }
  return { ok: true };
}
