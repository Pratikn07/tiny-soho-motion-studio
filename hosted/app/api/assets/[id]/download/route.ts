import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { signAssetDownload } from "@/lib/storage";

const assetIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const assetId = assetIdSchema.safeParse((await context.params).id);
    if (!assetId.success) throw new StudioError(400, "invalid_asset_id", "Asset ID is invalid.");

    const client = createServiceSupabaseClient();
    const asset = await new StudioRepository(client, owner).getAsset(assetId.data);
    if (!asset) throw new StudioError(404, "asset_not_found", "Asset was not found.");

    const signedUrl = await signAssetDownload(client, asset.object_path);
    return Response.json({ signedUrl, expiresIn: 300 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
