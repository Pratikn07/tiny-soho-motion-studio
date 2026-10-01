import { z } from "zod";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { RunsRepository } from "@/lib/repo/runs";
/** Fresh links for a chosen take, including a take from a run older than the slide's latest run. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { owner, client } = await openCreations(request);
    const runs = new RunsRepository(client, owner);
    const take = await runs.take(
      z
        .string()
        .uuid()
        .parse((await context.params).id),
    );
    if (!take)
      throw new StudioError(404, "take_not_found", "This take was not found.");
    const run = await runs.require(take.run_id);
    return Response.json(
      { run: await runs.view(run) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
