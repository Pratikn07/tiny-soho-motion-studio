import { z } from "zod";

import {
  LAYER_ASSET_KINDS,
  layerFinaliseRequestSchema,
  layerUploadRequestSchema,
  type LayerFinaliseResponse,
  type LayerUploadResponse,
} from "@/lib/contract";
import {
  findSlide,
  layerFileStem,
  layerObjectPath,
  mimeTypeForLayerPath,
  slideFolder,
  withSlideLayers,
  type LayerImage,
  type LayerName,
} from "@/lib/creations";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { openCreations, type LayerAssetRow } from "@/lib/repo/creations";
import { validateSourceImage } from "@/lib/storage";
import { runUploadChecks } from "@/lib/upload-checks";

export const maxDuration = 60;

const bucket = "creative-studio";
type Context = { params: Promise<{ id: string; slideId: string }> };
type Scope = Awaited<ReturnType<typeof open>>;

async function open(request: Request, context: Context) {
  const scope = await openCreations(request);
  const params = await context.params;
  const projectId = z.string().uuid().parse(params.id);
  const slideId = z.string().uuid().parse(params.slideId);
  const creation = await scope.repo.requireCreation(projectId);
  const slide = findSlide(creation.document, slideId);
  return { ...scope, projectId, slideId, creation, slide, folder: slideFolder(scope.owner.userId, projectId, slideId) };
}

export async function POST(request: Request, context: Context) {
  try {
    const scope = await open(request, context);
    const input = layerUploadRequestSchema.parse(await request.json());
    const signed = async (layer: LayerName, file: { assetId: string; mime: string }) => {
      if (await scope.repo.getAsset(file.assetId)) {
        throw new StudioError(409, "asset_exists", "This layer was already uploaded. Finalise it instead.");
      }
      const path = layerObjectPath(scope.owner.userId, scope.projectId, scope.slideId, layer, file.assetId, file.mime);
      const { data, error } = await scope.client.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
      if (error || !data) throw new StudioError(502, "upload_unavailable", "Layer upload is unavailable.");
      return { assetId: file.assetId, signedUrl: data.signedUrl as string };
    };
    const body: LayerUploadResponse = {
      uploads: {
        background: await signed("background", input.background),
        ...(input.text ? { text: await signed("text", input.text) } : {}),
      },
    };
    return Response.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

type FinalisedLayer = { asset: LayerAssetRow; bytes: Buffer };

async function readLayer(scope: Scope, asset: LayerAssetRow): Promise<FinalisedLayer> {
  const downloaded = await scope.client.storage.from(bucket).download(asset.object_path);
  if (downloaded.error || !downloaded.data) {
    throw new StudioError(502, "upload_incomplete", "The layer could not be read. Try again.");
  }
  return { asset, bytes: Buffer.from(await downloaded.data.arrayBuffer()) };
}

/** Reads the uploaded object, validates it and records its asset once; a retry returns the recorded asset. */
async function finaliseLayer(scope: Scope, layer: LayerName, assetId: string): Promise<FinalisedLayer> {
  const stem = layerFileStem(layer, assetId);
  const existing = await scope.repo.getAsset(assetId);
  if (existing) {
    if (
      existing.project_id !== scope.projectId
      || existing.kind !== LAYER_ASSET_KINDS[layer]
      || !existing.object_path.startsWith(`${scope.folder}/${stem}.`)
    ) {
      throw new StudioError(409, "asset_conflict", "This layer ID belongs to another upload.");
    }
    return readLayer(scope, existing);
  }
  const storage = scope.client.storage.from(bucket);
  const listed = await storage.list(scope.folder, { search: stem, limit: 10 });
  const object = (listed.data ?? []).find((entry: { name: string }) => entry.name.startsWith(`${stem}.`));
  if (listed.error || !object) {
    throw new StudioError(400, "layers_missing", "The layer upload is incomplete. Upload it again.");
  }
  const objectPath = `${scope.folder}/${object.name}`;
  const mimeType = mimeTypeForLayerPath(objectPath);
  if (!mimeType || (layer === "text" && mimeType !== "image/png")) {
    throw new StudioError(400, "layers_invalid", "The text layer must be a PNG with transparency.");
  }
  const downloaded = await storage.download(objectPath);
  if (downloaded.error || !downloaded.data) {
    throw new StudioError(502, "upload_incomplete", "The layer upload is incomplete. Try again.");
  }
  const image = await validateSourceImage(new File([downloaded.data], object.name, { type: mimeType }));
  const asset = await scope.repo.insertLayerAsset({
    id: assetId,
    projectId: scope.projectId,
    kind: LAYER_ASSET_KINDS[layer],
    name: object.name,
    mimeType: image.mimeType,
    objectPath,
    byteSize: image.bytes.length,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
  });
  return { asset, bytes: image.bytes };
}

const layerImage = (asset: LayerAssetRow): LayerImage => {
  if (!asset.width || !asset.height) throw new StudioError(400, "layers_invalid", "The layer has no pixel size.");
  return { assetId: asset.id, width: asset.width, height: asset.height };
};

export async function PUT(request: Request, context: Context) {
  try {
    const scope = await open(request, context);
    const input = layerFinaliseRequestSchema.parse(await request.json());
    const textAssetId = input.text === undefined ? scope.slide.layers.textAssetId : input.text?.assetId ?? null;

    if (
      scope.slide.checks
      && scope.slide.layers.backgroundAssetId === input.background.assetId
      && scope.slide.layers.textAssetId === textAssetId
    ) {
      const replay: LayerFinaliseResponse = { creation: scope.creation, checks: scope.slide.checks };
      return Response.json(replay);
    }

    const background = await finaliseLayer(scope, "background", input.background.assetId);
    let text: FinalisedLayer | null = null;
    if (input.text) text = await finaliseLayer(scope, "text", input.text.assetId);
    else if (textAssetId) {
      const stored = await scope.repo.getAsset(textAssetId);
      if (!stored) throw new StudioError(400, "layers_invalid", "The slide's text layer is missing. Upload it again.");
      text = await readLayer(scope, stored);
    }

    const checks = await runUploadChecks(background.bytes, text?.bytes ?? null);
    const document = withSlideLayers(scope.creation.document, scope.slideId, {
      background: layerImage(background.asset),
      textAssetId: text?.asset.id ?? null,
      checks,
    });
    const body: LayerFinaliseResponse = {
      creation: await scope.repo.saveCreation(scope.projectId, input.revision, document),
      checks,
    };
    return Response.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
