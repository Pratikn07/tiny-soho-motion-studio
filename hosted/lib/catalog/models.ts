import { DEFAULT_MODEL_ID, catalogModelSchema, type CatalogModel } from "@/lib/contract";

/**
 * Models the creator can choose for v2 creations. Prices carry their source and check date; recheck them in the
 * weekly billing reconciliation (O1). `calibrated` means P5's check thresholds were set on this model's clips.
 */
export const CATALOG_MODELS: readonly CatalogModel[] = [
  {
    id: DEFAULT_MODEL_ID,
    provider: "modal-ltx",
    providerModel: "ltx-2.5-22b-distilled",
    label: "Recommended",
    description: "Fast, keeps the child in place and loops smoothly. Tested on your slides.",
    pricing: {
      unit: "gpu_second",
      usd: 0.000842,
      source: "modal.com/pricing, RTX PRO 6000; ~36 s GPU per 5 s clip measured in benchmarks/gpu",
      checkedAt: "2026-09-29",
    },
    estimatedClipUsd: 0.03,
    supports: { endFrame: true, seeds: true, sizes: "multiple-of-64", durationsSeconds: [5] },
    promptProfile: "ltx",
    calibrated: true,
    enabled: true,
    requiresBillingAck: true,
  },
  {
    id: "wan2.7-i2v",
    provider: "alibaba",
    providerModel: "wan2.7-i2v",
    label: "Wan 2.7 (what the app used before)",
    description: "Alibaba's Wan 2.7. Costs much more per clip than the recommended model.",
    pricing: {
      unit: "video_second",
      usd: 0.1,
      source: "Alibaba Model Studio list price, Singapore region; recheck before relying on it",
      checkedAt: "2026-09-30",
    },
    estimatedClipUsd: 0.5,
    // First + last frame is a documented Wan 2.7 image-to-video combination (Model Studio API reference, 2026-09-30).
    supports: { endFrame: true, seeds: true, sizes: ["1280x720", "720x1280", "960x960"], durationsSeconds: [5] },
    promptProfile: "wan",
    calibrated: false,
    enabled: true,
    requiresBillingAck: true,
  },
  {
    id: "wan3-i2v",
    provider: "alibaba",
    providerModel: "wan3.0-video",
    label: "Wan 3 (newer)",
    description: "Alibaba's newer Wan model. Not yet tested on your slides.",
    pricing: {
      unit: "video_second",
      usd: 0.1,
      source: "Not confirmed; roadmap estimate $0.35–0.50 per clip, priced at the top until checked",
      checkedAt: "2026-09-30",
    },
    estimatedClipUsd: 0.5,
    supports: { endFrame: false, seeds: true, sizes: ["1280x720", "720x1280", "960x960"], durationsSeconds: [5] },
    promptProfile: "wan",
    calibrated: false,
    enabled: true,
    requiresBillingAck: true,
  },
].map((model) => catalogModelSchema.parse(model));

/** Alibaba catalog entries reuse the detailed request contracts in `hosted/lib/video-catalog.ts`. */
export const ALIBABA_CONTRACT_IDS: Readonly<Record<string, string>> = {
  "wan2.7-i2v": "wan2.7-i2v",
  "wan3-i2v": "wan3.0-video:image-to-video",
};

export function getCatalogModel(modelId: string): CatalogModel | null {
  return CATALOG_MODELS.find((model) => model.id === modelId) ?? null;
}
