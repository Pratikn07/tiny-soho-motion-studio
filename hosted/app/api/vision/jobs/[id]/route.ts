import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id } = await context.params;
    const job = await new StudioRepository(createServiceSupabaseClient(), owner).getVisionJob(id);
    if (!job) throw new StudioError(404, "vision_job_not_found", "Vision job was not found.");
    return Response.json({ job: {
      id: job.id,
      projectId: job.project_id,
      sourceAssetId: job.source_asset_id,
      operation: job.operation,
      status: job.status,
      outputAssetIds: job.output_asset_ids,
      errorCode: job.error_code,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
