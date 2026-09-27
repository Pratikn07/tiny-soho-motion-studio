import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository, type StudioJob } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { signAssetDownload } from "@/lib/storage";

const jobIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

const publicJob = (job: StudioJob, outputUrl?: string) => ({
  id: job.id,
  projectId: job.project_id,
  modelId: job.model_id,
  prompt: job.prompt,
  inputAssets: job.input_assets,
  options: job.options,
  status: job.status,
  outputAssetId: job.output_asset_id,
  errorCode: job.error_code,
  errorMessage: job.error_message,
  ...(outputUrl ? { outputUrl } : {}),
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const jobId = jobIdSchema.safeParse((await context.params).id);
    if (!jobId.success) throw new StudioError(400, "invalid_job_id", "Job ID is invalid.");

    const client = createServiceSupabaseClient();
    const repository = new StudioRepository(client, owner);
    const job = await repository.getJob(jobId.data);
    if (!job) throw new StudioError(404, "job_not_found", "Job was not found.");

    const outputAsset = job.output_asset_id ? await repository.getAsset(job.output_asset_id) : null;
    const outputUrl = outputAsset ? await signAssetDownload(client, outputAsset.object_path) : undefined;
    return Response.json({ job: publicJob(job, outputUrl) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
