import { z } from "zod";

import { createRunRequestSchema, type RunResponse } from "@/lib/contract";
import { findSlide } from "@/lib/creations";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { RunsRepository, planRun } from "@/lib/repo/runs";
import { StudioRepository } from "@/lib/repository";

type Context = { params: Promise<{ id: string; slideId: string }> };

/** Starts a server-side run for one slide. The worker carries it on even if the browser closes. */
export async function POST(request: Request, context: Context) {
  try {
    const { owner, client, repo } = await openCreations(request);
    const params = await context.params;
    const projectId = z.string().uuid().parse(params.id);
    const slideId = z.string().uuid().parse(params.slideId);
    const input = createRunRequestSchema.parse(await request.json());
    const creation = await repo.requireCreation(projectId);
    const plan = planRun({
      projectId,
      document: creation.document,
      slide: findSlide(creation.document, slideId),
      request: input,
      acknowledgements: await new StudioRepository(client, owner).listModelAcknowledgements(),
    });
    const runs = new RunsRepository(client, owner);
    const { run, created } = await runs.create(plan);
    const body: RunResponse = { run: await runs.view(run) };
    return Response.json(body, { status: created ? 201 : 200 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
