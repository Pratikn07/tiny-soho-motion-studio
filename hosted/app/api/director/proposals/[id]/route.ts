import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id } = await context.params;
    const proposal = await new StudioRepository(createServiceSupabaseClient(), owner).getDirectorProposal(id);
    if (!proposal) throw new StudioError(404, "director_proposal_not_found", "Director proposal was not found.");
    return Response.json({ proposal: {
      id: proposal.id,
      requestId: proposal.request_id,
      projectId: proposal.project_id,
      snapshot: proposal.snapshot,
      evidence: proposal.evidence,
      fingerprint: proposal.fingerprint,
      status: proposal.status,
      approvedAt: proposal.approved_at,
      createdAt: proposal.created_at,
      updatedAt: proposal.updated_at,
    } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
