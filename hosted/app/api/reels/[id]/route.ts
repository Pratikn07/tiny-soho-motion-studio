import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { ReelsRepository } from "@/lib/reels";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

/** One reel with the newest job for each step. A finished script is folded into the reel on read. */
export async function GET(request: Request, context: Context) {
  try {
    const owner = await requireOwner(request);
    const id = z.string().uuid().parse((await context.params).id);
    const repo = new ReelsRepository(createServiceSupabaseClient() as never, owner.userId);
    return Response.json(await repo.absorb(await repo.get(id)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
