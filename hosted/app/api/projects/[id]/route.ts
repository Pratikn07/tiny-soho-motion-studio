import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const projectIdSchema = z.string().uuid();
const quotaSchema = z.object({
  freeQuotaModels: z.array(z.string().min(1)).max(2),
  freeQuotaConfirmedAt: z.record(z.string(), z.string()),
});

const repositoryFor = (owner: Awaited<ReturnType<typeof requireOwner>>) => (
  new StudioRepository(createServiceSupabaseClient(), owner)
);

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const projectId = projectIdSchema.safeParse((await context.params).id);
    if (!projectId.success) throw new StudioError(400, "invalid_project_id", "Project ID is invalid.");
    const project = await repositoryFor(owner).getProject(projectId.data);
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");
    return Response.json({ project });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const projectId = projectIdSchema.safeParse((await context.params).id);
    const quota = quotaSchema.safeParse(await request.json());
    if (!projectId.success || !quota.success) {
      throw new StudioError(400, "invalid_project_settings", "Project settings are invalid.");
    }
    const project = await repositoryFor(owner).updateProjectQuota({ projectId: projectId.data, ...quota.data });
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");
    return Response.json({ project });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
