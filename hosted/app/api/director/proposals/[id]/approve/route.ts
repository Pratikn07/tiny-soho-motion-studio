import { requireOwner } from "@/lib/auth";
import { buildDirectorApprovalJobs } from "@/lib/director";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository, type StudioJob } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

type RouteContext = { params: Promise<{ id: string }> };

const publicJob = (job: StudioJob) => ({
  id: job.id,
  projectId: job.project_id,
  modelId: job.model_id,
  prompt: job.prompt,
  inputAssets: job.input_assets,
  options: job.options,
  status: job.status,
  outputAssetId: job.output_asset_id,
  errorCode: job.error_code,
  errorMessage: job.error_message,
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id } = await context.params;
    const repository = new StudioRepository(createServiceSupabaseClient(), owner);
    const proposal = await repository.getDirectorProposal(id);
    if (!proposal) throw new StudioError(404, "director_proposal_not_found", "Director proposal was not found.");
    if (proposal.status !== "drafted") {
      throw new StudioError(409, "director_proposal_not_approvable", "This Director proposal has already been handled.");
    }

    const [assets, acknowledgements] = await Promise.all([
      repository.listAssets(proposal.project_id),
      repository.listModelAcknowledgements(),
    ]);
    const jobs = buildDirectorApprovalJobs(proposal.id, proposal.snapshot, {
      projectId: proposal.project_id,
      assets: assets.map((asset) => ({ id: asset.id, projectId: asset.project_id })),
      acknowledgements: acknowledgements.map((acknowledgement) => ({
        modelId: acknowledgement.model_id,
        contractVersion: acknowledgement.contract_version,
      })),
    });
    const approvedJobs = await repository.approveDirectorProposal({
      proposalId: proposal.id,
      expectedFingerprint: proposal.fingerprint,
      jobs,
    });
    return Response.json({ jobs: approvedJobs.map(publicJob) }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
