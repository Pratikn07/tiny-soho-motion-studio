import { z } from "zod";

import {
  finishedFinaliseRequestSchema,
  finishedUploadRequestSchema,
  type FinishedFinaliseResponse,
  type FinishedUploadResponse,
} from "@/lib/contract";
import { findSlide, slideFolder } from "@/lib/creations";
import { BUCKET, finishedFileStem, finishedObjectPath, mimeForFinishedPath } from "@/lib/direction";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { DirectionRepository } from "@/lib/repo/direction";
import { validateSourceImage } from "@/lib/storage";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string; slideId: string }> };

async function open(request: Request, context: Context) {
  const scope = await openCreations(request);
  const params = await context.params;
  const projectId = z.string().uuid().parse(params.id);
  const slideId = z.string().uuid().parse(params.slideId);
  const creation = await scope.repo.requireCreation(projectId);
  findSlide(creation.document, slideId);
  return {
    ...scope,
    projectId,
    slideId,
    direction: new DirectionRepository(scope.client, scope.owner),
    folder: slideFolder(scope.owner.userId, projectId, slideId),
  };
}

/** Signed upload URL for one finished slide (the creator's design with its text baked in). */
export async function POST(request: Request, context: Context) {
  try {
    const scope = await open(request, context);
    const input = finishedUploadRequestSchema.parse(await request.json());
    if (await scope.direction.getAsset(input.assetId)) {
      throw new StudioError(409, "asset_exists", "This slide was already uploaded. Finalise it instead.");
    }
    const path = finishedObjectPath(scope.owner.userId, scope.projectId, scope.slideId, input.assetId, input.mime);
    const { data, error } = await scope.client.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new StudioError(502, "upload_unavailable", "Slide upload is unavailable.");
    const body: FinishedUploadResponse = { assetId: input.assetId, signedUrl: data.signedUrl as string };
    return Response.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Reads the uploaded finished slide, validates it and records it once; a retry returns the recorded asset. */
export async function PUT(request: Request, context: Context) {
  try {
    const scope = await open(request, context);
    const { assetId } = finishedFinaliseRequestSchema.parse(await request.json());
    const stem = finishedFileStem(assetId);
    const existing = await scope.direction.getAsset(assetId);
    if (existing) {
      if (existing.project_id !== scope.projectId || existing.kind !== "source-image"
        || !existing.object_path.startsWith(`${scope.folder}/${stem}.`) || !existing.width || !existing.height) {
        throw new StudioError(409, "asset_conflict", "This slide ID belongs to another upload.");
      }
      const replay: FinishedFinaliseResponse = { assetId, width: existing.width, height: existing.height };
      return Response.json(replay);
    }
    const storage = scope.client.storage.from(BUCKET);
    const listed = await storage.list(scope.folder, { search: stem, limit: 10 });
    const object = (listed.data ?? []).find((entry: { name: string }) => entry.name.startsWith(`${stem}.`));
    if (listed.error || !object) {
      throw new StudioError(400, "finished_missing", "The slide upload is incomplete. Upload it again.");
    }
    const objectPath = `${scope.folder}/${object.name}`;
    const mimeType = mimeForFinishedPath(objectPath);
    const downloaded = await storage.download(objectPath);
    if (!mimeType || downloaded.error || !downloaded.data) {
      throw new StudioError(400, "finished_missing", "The slide upload is incomplete. Upload it again.");
    }
    const image = await validateSourceImage(new File([downloaded.data], object.name, { type: mimeType }));
    const asset = await scope.direction.insertAsset({
      id: assetId,
      projectId: scope.projectId,
      kind: "source-image",
      name: object.name,
      mimeType: image.mimeType,
      objectPath,
      byteSize: image.bytes.length,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      provenance: { source: "creation-finished-upload", slideId: scope.slideId },
    });
    const body: FinishedFinaliseResponse = { assetId: asset.id, width: image.width, height: image.height };
    return Response.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
