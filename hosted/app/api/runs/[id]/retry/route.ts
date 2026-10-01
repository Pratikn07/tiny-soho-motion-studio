import { z } from "zod";

import { assertBudgetFor } from "@/lib/budget";
import { getCatalogModel } from "@/lib/catalog/models";
import type { RunResponse } from "@/lib/contract";
import { routeErrorResponse } from "@/lib/http";
import { openCreations } from "@/lib/repo/creations";
import { RunsRepository } from "@/lib/repo/runs";

/** "Try another take": adds one attempt; the worker reserves its budget before generating. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { owner, client } = await openCreations(request);
    const runs = new RunsRepository(client, owner);
    const current = await runs.require(z.string().uuid().parse((await context.params).id));
    await assertBudgetFor(client, owner, getCatalogModel(current.model_id)?.estimatedClipUsd ?? 0);
    const run = await runs.retry(current);
    const body: RunResponse = { run: await runs.view(run) };
    return Response.json(body);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
