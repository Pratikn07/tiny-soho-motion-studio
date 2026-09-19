import type { createStore } from "./store";

type Shot = { prompt: string; modelId: string; duration?: number; resolution?: string; inputAssetIds?: string[]; inputRoles?: string[] };
export function approveProposalJobs(store: ReturnType<typeof createStore>, proposalId: string, eligibleModels: Set<string>) {
  const proposal = store.getProposal(proposalId); if (!proposal) throw new Error("Proposal not found"); if (proposal.approved_at) throw new Error("Proposal is already approved."); const body = JSON.parse(proposal.proposal) as { shots?: Shot[] }; if (!Array.isArray(body.shots) || body.shots.length === 0 || body.shots.length > 20) throw new Error("Proposal must contain 1 to 20 shots.");
  for (const shot of body.shots) { if (!shot.prompt?.trim() || !eligibleModels.has(shot.modelId)) throw new Error("Every proposed model must be confirmed for Free Quota Only."); }
  const approved = store.approveProposal(proposalId); return body.shots.map((shot, index) => store.createJob({ projectId: proposal.project_id, idempotencyKey: `${proposalId}:${index}`, modelId: shot.modelId, task: (shot.inputAssetIds?.length ? "image-to-video" : "text-to-video"), prompt: shot.prompt, inputAssetIds: shot.inputAssetIds || [], options: { duration: shot.duration || 5, resolution: shot.resolution || "720P", inputRoles: shot.inputRoles || [] } }));
}
