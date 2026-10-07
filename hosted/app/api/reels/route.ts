import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { createReelSchema, ReelsRepository } from "@/lib/reels";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const repo = async (request: Request) =>
  new ReelsRepository(createServiceSupabaseClient() as never, (await requireOwner(request)).userId);

/** The owner's reels, newest first. */
export async function GET(request: Request) {
  try {
    return Response.json({ reels: await (await repo(request)).list() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Starts a reel from a topic and queues its first job on the Studio Mac: three story ideas. */
export async function POST(request: Request) {
  try {
    const input = createReelSchema.parse(await request.json());
    return Response.json(await (await repo(request)).create(input), { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
