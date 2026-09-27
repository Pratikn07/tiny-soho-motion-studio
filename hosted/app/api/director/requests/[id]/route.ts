import { requireOwner } from "@/lib/auth";
import { publicDirectorRequest } from "@/lib/director";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id } = await context.params;
    const repository = new StudioRepository(createServiceSupabaseClient(), owner);
    const [directorRequest, proposal] = await Promise.all([
      repository.getDirectorRequest(id),
      repository.getDirectorProposalForRequest(id),
    ]);
    if (!directorRequest) throw new StudioError(404, "director_request_not_found", "Director request was not found.");
    return Response.json({ request: { ...publicDirectorRequest(directorRequest), proposalId: proposal?.id ?? null } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
