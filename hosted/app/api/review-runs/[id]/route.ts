import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import type { ReviewRunResponse } from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { ReviewRunsRepository, reviewRunView } from "@/lib/review/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireOwner(request);
    const id = z.string().uuid().parse((await context.params).id);
    const row = await new ReviewRunsRepository(createServiceSupabaseClient(), owner).get(id);
    if (!row) throw new StudioError(404, "review_run_not_found", "This review was not found.");
    const body: ReviewRunResponse = { reviewRun: reviewRunView(row) };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
