import { z } from "zod";

import { saveCreationRequestSchema } from "@/lib/contract";
import { assertOwnedLayers } from "@/lib/creations";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { repo } = await openCreations(request);
    const id = z.string().uuid().parse((await context.params).id);
    return Response.json(await repo.requireCreation(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { repo } = await openCreations(request);
    const id = z.string().uuid().parse((await context.params).id);
    await repo.requireCreation(id);
    const input = saveCreationRequestSchema.parse(await request.json());
    await assertOwnedLayers(input.document, id, (assetId) => repo.getAsset(assetId));
    return Response.json(await repo.saveCreation(id, input.revision, input.document));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
