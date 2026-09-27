import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { assertOwnedSlides, carouselDocumentSchema } from "@/lib/carousel";
const inputSchema = z.object({
  revision: z.number().int().nonnegative(),
  document: carouselDocumentSchema,
});
type Context = { params: Promise<{ id: string }> };
async function scope(request: Request, context: Context) {
  const owner = await requireOwner(request);
  const id = z
    .string()
    .uuid()
    .parse((await context.params).id);
  const repo = new StudioRepository(createServiceSupabaseClient(), owner);
  const project = await repo.getProject(id);
  if (!project)
    throw new StudioError(404, "project_not_found", "Project was not found.");
  return { repo, project };
}
export async function GET(request: Request, context: Context) {
  try {
    const { project } = await scope(request, context);
    return Response.json(
      {
        id: project.id,
        revision: project.carousel_revision ?? 0,
        document: project.carousel_document ?? {
          name: project.name,
          slides: [],
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { repo, project } = await scope(request, context);
    const value = inputSchema.safeParse(await request.json());
    if (!value.success)
      throw new StudioError(
        400,
        "invalid_carousel",
        "The project contains an invalid slide or movement area.",
      );
    await assertOwnedSlides(value.data.document.slides, project.id, (id) =>
      repo.getAsset(id),
    );
    const saved = await repo.saveCarousel(
      project.id,
      value.data.revision,
      value.data.document,
    );
    return Response.json({
      id: saved.id,
      revision: saved.carousel_revision,
      document: saved.carousel_document,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
