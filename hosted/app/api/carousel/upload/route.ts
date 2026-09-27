import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { validateSourceImage } from "@/lib/storage";
const inputSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  type: z.enum(["image/png", "image/jpeg", "image/webp"]),
});
export const maxDuration = 60;
async function scope(request: Request) {
  const owner = await requireOwner(request),
    input = inputSchema.parse(await request.json()),
    client = createServiceSupabaseClient(),
    repo = new StudioRepository(client, owner);
  if (!(await repo.getProject(input.projectId)))
    throw new StudioError(404, "project_not_found", "Project was not found.");
  const path = `owners/${owner.userId}/projects/${input.projectId}/carousel/${input.assetId}`;
  return { input, client, repo, path };
}
export async function POST(request: Request) {
  try {
    const { input, client, repo, path } = await scope(request);
    if (await repo.getAsset(input.assetId))
      throw new StudioError(
        409,
        "asset_exists",
        "This image was already uploaded.",
      );
    const { data, error } = await client.storage
      .from("creative-studio")
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data)
      throw new StudioError(
        502,
        "upload_unavailable",
        "Image upload is unavailable.",
      );
    return Response.json({ signedUrl: data.signedUrl });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
export async function PUT(request: Request) {
  try {
    const { input, client, repo, path } = await scope(request);
    const existing = await repo.getAsset(input.assetId);
    if (existing) {
      if (
        existing.project_id !== input.projectId ||
        existing.object_path !== path
      )
        throw new StudioError(
          409,
          "asset_conflict",
          "Image ID belongs to another upload.",
        );
      return Response.json({ asset: existing });
    }
    const { data, error } = await client.storage
      .from("creative-studio")
      .download(path);
    if (error || !data)
      throw new StudioError(
        502,
        "upload_incomplete",
        "Image upload is incomplete. Try saving again.",
      );
    const image = await validateSourceImage(
      new File([data], input.name, { type: input.type }),
    );
    const asset = await repo.createAsset({
      id: input.assetId,
      projectId: input.projectId,
      kind: "source-image",
      name: input.name,
      mimeType: image.mimeType,
      objectPath: path,
      byteSize: image.bytes.length,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
    });
    return Response.json({ asset });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
