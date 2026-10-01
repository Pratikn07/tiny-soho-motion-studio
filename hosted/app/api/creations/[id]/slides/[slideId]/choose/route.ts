import { z } from "zod";

import { chooseTakeRequestSchema, creationDocumentV2Schema } from "@/lib/contract";
import { findSlide } from "@/lib/creations";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { RunsRepository } from "@/lib/repo/runs";

type Context = { params: Promise<{ id: string; slideId: string }> };

/** Sets the slide's chosen take (and its run as the latest), with the usual revision check. */
export async function POST(request: Request, context: Context) {
  try {
    const { owner, client, repo } = await openCreations(request);
    const params = await context.params;
    const projectId = z.string().uuid().parse(params.id);
    const slideId = z.string().uuid().parse(params.slideId);
    const input = chooseTakeRequestSchema.parse(await request.json());
    const creation = await repo.requireCreation(projectId);
    findSlide(creation.document, slideId);
    const take = await new RunsRepository(client, owner).take(input.takeId);
    if (!take || take.project_id !== projectId || take.slide_id !== slideId) {
      throw new StudioError(404, "take_not_found", "This take was not found for this slide.");
    }
    if (!take.final_asset_id) throw new StudioError(400, "take_not_ready", "This take isn't finished yet.");
    const document = creationDocumentV2Schema.parse({
      ...creation.document,
      slides: creation.document.slides.map((slide) => (
        slide.id === slideId ? { ...slide, chosenTakeId: take.id, latestRunId: take.run_id } : slide
      )),
    });
    return Response.json(await repo.saveCreation(projectId, input.revision, document));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
