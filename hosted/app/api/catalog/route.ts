import { requireOwner } from "@/lib/auth";
import { catalogView } from "@/lib/catalog/view";
import { catalogQuerySchema, creationDocumentV2Schema } from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const query = catalogQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const repo = new StudioRepository(createServiceSupabaseClient(), owner);
    let slide;
    if (query.creationId && query.slideId) {
      const project = await repo.getProject(query.creationId);
      const document = creationDocumentV2Schema.safeParse(project?.carousel_document);
      if (!document.success) throw new StudioError(404, "project_not_found", "Creation was not found.");
      slide = document.data.slides.find((candidate) => candidate.id === query.slideId);
      if (!slide) throw new StudioError(404, "slide_not_found", "This slide is not in the creation.");
    }
    const acknowledgements = await repo.listModelAcknowledgements();
    return Response.json(catalogView({ acknowledgements, slide }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
