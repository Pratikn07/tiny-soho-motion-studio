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
    const run = await new StudioRepository(createServiceSupabaseClient(), owner).getWorkflowRun(id);
    if (!run) throw new StudioError(404, "workflow_run_not_found", "Workflow run was not found.");
    return Response.json({ run: {
      id: run.id,
      workflowId: run.workflow_id,
      projectId: run.project_id,
      graphSnapshot: run.graph_snapshot,
      nodeState: run.node_state,
      status: run.status,
      errorCode: run.error_code,
      errorMessage: run.error_message,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
