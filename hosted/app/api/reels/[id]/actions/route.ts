import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { reelActionSchema, ReelsRepository } from "@/lib/reels";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

/** The creator's decisions: pick an idea, ask for script changes, approve the script, or retry a failed step. */
export async function POST(request: Request, context: Context) {
  try {
    const owner = await requireOwner(request);
    const id = z.string().uuid().parse((await context.params).id);
    const action = reelActionSchema.parse(await request.json());
    return Response.json(await new ReelsRepository(createServiceSupabaseClient() as never, owner.userId).act(id, action));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
