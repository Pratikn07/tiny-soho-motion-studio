import { z } from "zod";

import type { RunResponse } from "@/lib/contract";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { RunsRepository } from "@/lib/repo/runs";

/** "Try another take": adds one attempt; the worker reserves its budget before generating. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { owner, client } = await openCreations(request);
    const runs = new RunsRepository(client, owner);
    const run = await runs.retry(await runs.require(z.string().uuid().parse((await context.params).id)));
    const body: RunResponse = { run: await runs.view(run) };
    return Response.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
