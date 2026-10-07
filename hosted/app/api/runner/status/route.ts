import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { RunnerRepository } from "@/lib/runner";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

/** The Studio Mac chip: whether the runner is online, asleep or not set up, and how many reel jobs wait. */
export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const status = await new RunnerRepository(createServiceSupabaseClient() as never, owner.userId).status();
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
