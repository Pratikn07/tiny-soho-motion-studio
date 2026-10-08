import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { ReelImageStore } from "@/lib/reel-images";
import { ReelsRepository } from "@/lib/reels";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

/** One reel with the newest job for each step. A finished script is folded into the reel on read. */
export async function GET(request: Request, context: Context) {
  try {
    const owner = await requireOwner(request);
    const id = z.string().uuid().parse((await context.params).id);
    const client = createServiceSupabaseClient();
    const repo = new ReelsRepository(client as never, owner.userId);
    const view = await new ReelImageStore(client as never, owner.userId, id).withUrls(await repo.absorb(await repo.get(id)));
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
