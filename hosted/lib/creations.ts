import {
  DEFAULT_MODEL_ID,
  DEFAULT_TEXT_ANIMATION,
  LAYER_ASSET_KINDS,
  creationDocumentV2Schema,
  type CreationDocumentV2,
  type LayerAssetKind,
  type SlideV2,
  type UploadCheckResult,
} from "@/lib/contract";
import { StudioError } from "@/lib/errors";

export type LayerName = keyof typeof LAYER_ASSET_KINDS;

const extensionForMime: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const mimeForExtension: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function newCreationDocument(name: string): CreationDocumentV2 {
  return creationDocumentV2Schema.parse({
    version: 2,
    name,
    defaults: { modelId: DEFAULT_MODEL_ID, motionStyle: "calm", textAnimation: DEFAULT_TEXT_ANIMATION },
    slides: [],
  });
}

/** The stored document if it is a valid v2 creation; legacy carousel documents return null. */
export function readCreationDocument(value: unknown): CreationDocumentV2 | null {
  const parsed = creationDocumentV2Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function findSlide(document: CreationDocumentV2, slideId: string): SlideV2 {
  const slide = document.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new StudioError(404, "slide_not_found", "This slide is not in the creation. Save the creation first.");
  return slide;
}

export const slideFolder = (ownerUserId: string, projectId: string, slideId: string) => (
  `owners/${ownerUserId}/projects/${projectId}/slides/${slideId}`
);

export const layerFileStem = (layer: LayerName, assetId: string) => `${layer}-${assetId}`;

export function layerObjectPath(
  ownerUserId: string,
  projectId: string,
  slideId: string,
  layer: LayerName,
  assetId: string,
  mimeType: string,
) {
  const extension = extensionForMime[mimeType];
  if (!extension) throw new StudioError(400, "layers_invalid", "Upload a PNG, JPEG or WebP background and a PNG text layer.");
  return `${slideFolder(ownerUserId, projectId, slideId)}/${layerFileStem(layer, assetId)}.${extension}`;
}

export function mimeTypeForLayerPath(objectPath: string) {
  return mimeForExtension[objectPath.slice(objectPath.lastIndexOf(".") + 1)] ?? null;
}

export type LayerImage = { assetId: string; width: number; height: number };

/**
 * Points the slide at new layers. A new background or text layer makes the slide's AI review stale, so its
 * `reviewRunId` is dropped; motion, runs and the chosen take stay for the creator to decide.
 */
export function withSlideLayers(
  document: CreationDocumentV2,
  slideId: string,
  layers: { background: LayerImage; textAssetId: string | null; checks: UploadCheckResult },
): CreationDocumentV2 {
  findSlide(document, slideId);
  return creationDocumentV2Schema.parse({
    ...document,
    slides: document.slides.map((slide) => {
      if (slide.id !== slideId) return slide;
      const changed = slide.layers.backgroundAssetId !== layers.background.assetId
        || slide.layers.textAssetId !== layers.textAssetId;
      const { reviewRunId: _staleReview, direction: _staleDirection, ...rest } = slide;
      return {
        ...(changed ? rest : slide),
        width: layers.background.width,
        height: layers.background.height,
        layers: { backgroundAssetId: layers.background.assetId, textAssetId: layers.textAssetId },
        checks: layers.checks,
      };
    }),
  });
}

type OwnedAsset = { project_id: string; kind: string; width: number | null; height: number | null } | null;

/** Every layer a saved document points to must be this project's asset of the right kind and size. */
export async function assertOwnedLayers(
  document: CreationDocumentV2,
  projectId: string,
  getAsset: (assetId: string) => Promise<OwnedAsset>,
) {
  for (const slide of document.slides) {
    const references: Array<[string | null, LayerAssetKind]> = [
      [slide.layers.backgroundAssetId, LAYER_ASSET_KINDS.background],
      [slide.layers.textAssetId, LAYER_ASSET_KINDS.text],
    ];
    for (const [assetId, kind] of references) {
      if (!assetId) continue;
      const asset = await getAsset(assetId);
      if (!asset || asset.project_id !== projectId || asset.kind !== kind) {
        throw new StudioError(400, "layers_invalid", "Every slide must use layers uploaded to this creation.");
      }
      if (kind === LAYER_ASSET_KINDS.background && (asset.width !== slide.width || asset.height !== slide.height)) {
        throw new StudioError(400, "layers_invalid", "A slide's size must match its background layer.");
      }
    }
  }
}
