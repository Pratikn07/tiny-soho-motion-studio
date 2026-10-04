import { z } from "zod";

import { directionView, refreshDirection } from "@/lib/direction";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { DirectionRepository } from "@/lib/repo/direction";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string; runId: string }> };

/** The run's status. While it runs, this also checks for the routine's result and turns it into slide layers. */
export async function GET(request: Request, context: Context) {
  try {
    const scope = await openCreations(request);
    const params = await context.params;
    const projectId = z.string().uuid().parse(params.id);
    const runId = z.string().uuid().parse(params.runId);
    const full = { ...scope, direction: new DirectionRepository(scope.client, scope.owner) };
    const run = await full.direction.getRun(projectId, runId);
    if (!run) throw new StudioError(404, "direction_not_found", "Direction run was not found.");
    const refreshed = await refreshDirection(full as never, run);
    return Response.json(await directionView(full as never, refreshed));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
