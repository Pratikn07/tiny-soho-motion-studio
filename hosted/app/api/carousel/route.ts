import { requireOwner } from "@/lib/auth";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const projects = await new StudioRepository(createServiceSupabaseClient(), owner)
      .listCarouselProjects();
    return Response.json({
      creations: projects.map((project) => ({
        id: project.id,
        name: project.name,
        updatedAt: project.updated_at,
        slideCount: project.carousel_document?.slides.length ?? 0,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
