import { routeErrorResponse } from "@/lib/http";
import { claimSchema, readRunnerConfig, requireRunner, RunnerRepository } from "@/lib/runner";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

/** The runner claims the oldest waiting reel job. 204 when there is nothing to do. */
export async function POST(request: Request) {
  try {
    const { ownerId } = requireRunner(request, readRunnerConfig());
    const { runnerId } = claimSchema.parse(await request.json());
    const claimed = await new RunnerRepository(createServiceSupabaseClient() as never, ownerId).claim(runnerId);
    return claimed ? Response.json(claimed) : new Response(null, { status: 204 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
