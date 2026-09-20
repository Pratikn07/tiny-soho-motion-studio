import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  canvas: z.string().trim().regex(/^\d{2,4}x\d{2,4}$/).default("1080x1920"),
});

const repositoryFor = (owner: Awaited<ReturnType<typeof requireOwner>>) => (
  new StudioRepository(createServiceSupabaseClient(), owner)
);

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const projects = await repositoryFor(owner).listProjects();
    return Response.json({ projects });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = createProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new StudioError(400, "invalid_project", "Provide a project name and canvas.");
    }
    const project = await repositoryFor(owner).createProject(parsed.data);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
