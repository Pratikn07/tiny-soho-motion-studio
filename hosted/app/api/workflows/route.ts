import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import type { StudioWorkflow } from "@/lib/creative-suite";
import { StudioError } from "@/lib/errors";
import { generationFingerprint } from "@/lib/generation";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { validateWorkflowGraph } from "@/lib/workflows";

const createWorkflowSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  graph: z.unknown(),
}).strict();

const publicWorkflow = (workflow: StudioWorkflow) => ({
  id: workflow.id,
  projectId: workflow.project_id,
  name: workflow.name,
  graphVersion: workflow.graph_version,
  graph: workflow.graph,
  fingerprint: workflow.fingerprint,
  createdAt: workflow.created_at,
});

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const workflows = await new StudioRepository(createServiceSupabaseClient(), owner).listWorkflows(projectId);
    return Response.json({ workflows: workflows.map(publicWorkflow) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = createWorkflowSchema.safeParse(await request.json());
    if (!parsed.success) throw new StudioError(400, "invalid_workflow_request", "Workflow request is invalid.");
    const repository = new StudioRepository(createServiceSupabaseClient(), owner);
    const project = await repository.getProject(parsed.data.projectId);
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");
    const capabilities = await repository.listVisionCapabilities();
    const graph = validateWorkflowGraph(parsed.data.graph, capabilities.map((capability) => ({
      capabilityId: capability.capability_id,
      status: capability.status,
    })));
    const fingerprint = generationFingerprint({ projectId: project.id, name: parsed.data.name, graph });
    const existing = await repository.findWorkflowByFingerprint(fingerprint);
    if (existing) return Response.json({ workflow: publicWorkflow(existing) });
    const workflow = await repository.createWorkflow({
      id: crypto.randomUUID(),
      projectId: project.id,
      name: parsed.data.name,
      graph,
      fingerprint,
    });
    return Response.json({ workflow: publicWorkflow(workflow) }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
