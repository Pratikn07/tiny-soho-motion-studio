import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import type { StudioWorkflowRun } from "@/lib/creative-suite";
import { StudioError } from "@/lib/errors";
import { generationFingerprint } from "@/lib/generation";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type RouteContext = { params: Promise<{ id: string }> };

const createRunSchema = z.object({
  projectId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
}).strict();

const publicRun = (run: StudioWorkflowRun) => ({
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
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id } = await context.params;
    const parsed = createRunSchema.safeParse(await request.json());
    if (!parsed.success) throw new StudioError(400, "invalid_workflow_run", "Workflow run request is invalid.");
    const repository = new StudioRepository(createServiceSupabaseClient(), owner);
    const workflow = await repository.getWorkflow(id);
    if (!workflow || workflow.project_id !== parsed.data.projectId) {
      throw new StudioError(404, "workflow_not_found", "Workflow was not found for this project.");
    }
    const fingerprint = generationFingerprint({ workflowId: workflow.id, projectId: workflow.project_id, graph: workflow.graph });
    const existing = await repository.findWorkflowRunByIdempotency(parsed.data.projectId, parsed.data.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new StudioError(409, "idempotency_conflict", "This idempotency key belongs to a different workflow run.");
      }
      return Response.json({ run: publicRun(existing) });
    }
    const run = await repository.createWorkflowRun({
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      projectId: parsed.data.projectId,
      idempotencyKey: parsed.data.idempotencyKey,
      fingerprint,
      graphSnapshot: workflow.graph,
    });
    return Response.json({ run: publicRun(run) }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
