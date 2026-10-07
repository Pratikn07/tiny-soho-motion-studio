import { z } from "zod";

import { routeErrorResponse } from "@/lib/http";
import { jobUpdateSchema, readRunnerConfig, requireRunner, RunnerRepository } from "@/lib/runner";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

/** The runner reports progress (renewing its lease) or finishes the job with a result. */
export async function PATCH(request: Request, context: Context) {
  try {
    const { ownerId } = requireRunner(request, readRunnerConfig());
    const jobId = z.string().uuid().parse((await context.params).id);
    const input = jobUpdateSchema.parse(await request.json());
    const job = await new RunnerRepository(createServiceSupabaseClient() as never, ownerId).updateJob(jobId, input);
    return Response.json(job);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
