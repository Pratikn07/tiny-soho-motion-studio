import { routeErrorResponse } from "@/lib/http";
import { heartbeatSchema, readRunnerConfig, requireRunner, RunnerRepository } from "@/lib/runner";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

/** The Studio Mac runner checks in every 20 seconds so the Studio can show it as online. */
export async function POST(request: Request) {
  try {
    const { ownerId } = requireRunner(request, readRunnerConfig());
    const input = heartbeatSchema.parse(await request.json());
    await new RunnerRepository(createServiceSupabaseClient() as never, ownerId).heartbeat(input);
    return new Response(null, { status: 204 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
