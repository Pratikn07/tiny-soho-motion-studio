import { z } from "zod";

import { routeErrorResponse } from "@/lib/http";
import { jobFileSchema, readRunnerConfig, requireRunner, RunnerRepository } from "@/lib/runner";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

/** The runner asks for a one-time link to upload a file its job made (a voice take). */
export async function POST(request: Request, context: Context) {
  try {
    const { ownerId } = requireRunner(request, readRunnerConfig());
    const jobId = z.string().uuid().parse((await context.params).id);
    const input = jobFileSchema.parse(await request.json());
    return Response.json(await new RunnerRepository(createServiceSupabaseClient() as never, ownerId).jobFileUpload(jobId, input));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
