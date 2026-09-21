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
    const workflow = await new StudioRepository(createServiceSupabaseClient(), owner).getWorkflow(id);
    if (!workflow) throw new StudioError(404, "workflow_not_found", "Workflow was not found.");
    return Response.json({ workflow: {
      id: workflow.id,
      projectId: workflow.project_id,
      name: workflow.name,
      graphVersion: workflow.graph_version,
      graph: workflow.graph,
      fingerprint: workflow.fingerprint,
      createdAt: workflow.created_at,
    } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
