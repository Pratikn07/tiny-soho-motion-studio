import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { uploadSourceMedia } from "@/lib/storage";

const projectIdSchema = z.string().uuid();

const repositoryFor = (owner: Awaited<ReturnType<typeof requireOwner>>) => (
  new StudioRepository(createServiceSupabaseClient(), owner)
);

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const projectId = projectIdSchema.safeParse(new URL(request.url).searchParams.get("projectId"));
    if (!projectId.success) throw new StudioError(400, "invalid_project_id", "Project ID is invalid.");
    const assets = await repositoryFor(owner).listAssets(projectId.data);
    return Response.json({ assets });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const formData = await request.formData();
    const projectId = projectIdSchema.safeParse(formData.get("projectId"));
    const file = formData.get("file");
    if (!projectId.success || !(file instanceof File)) {
      throw new StudioError(400, "invalid_asset_upload", "Provide a project and source media file.");
    }

    const repository = repositoryFor(owner);
    const project = await repository.getProject(projectId.data);
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");

    const assetId = crypto.randomUUID();
    const client = createServiceSupabaseClient();
    const uploaded = await uploadSourceMedia({
      client,
      ownerUserId: owner.userId,
      projectId: project.id,
      assetId,
      file,
    });

    try {
      const asset = await repository.createAsset({
        id: assetId,
        projectId: project.id,
        kind: uploaded.kind,
        name: file.name,
        mimeType: uploaded.mimeType,
        objectPath: uploaded.objectPath,
        byteSize: uploaded.bytes.byteLength,
        width: uploaded.width,
        height: uploaded.height,
        sha256: uploaded.sha256,
      });
      return Response.json({ asset }, { status: 201 });
    } catch (error) {
      await client.storage.from("creative-studio").remove([uploaded.objectPath]);
      throw error;
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
