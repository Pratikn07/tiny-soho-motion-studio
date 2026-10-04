import { z } from "zod";

import { directionStartRequestSchema } from "@/lib/contract";
import { directionView, readRoutineConfig, startDirection } from "@/lib/direction";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { DirectionRepository } from "@/lib/repo/direction";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/**
 * Direct finished slides: the Claude Code routine removes their text, re-sets it with motion, checks its own
 * frames and uploads clean layers. Poll `GET /api/creations/:id/direction/:runId` for the result.
 */
export async function POST(request: Request, context: Context) {
  try {
    const config = readRoutineConfig();
    if (!config) {
      throw new StudioError(503, "direction_not_configured", "The motion director is not set up yet.");
    }
    const scope = await openCreations(request);
    const projectId = z.string().uuid().parse((await context.params).id);
    const input = directionStartRequestSchema.parse(await request.json());
    const full = { ...scope, direction: new DirectionRepository(scope.client, scope.owner) };
    const run = await startDirection(full as never, projectId, input, config);
    return Response.json(await directionView(full as never, run), { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
