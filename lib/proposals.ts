import { z } from "zod";
import { getModel } from "./models";
import { preflightGeneration, queueGeneration, type GenerationDraft } from "./generation";
import type { createStore } from "./store";

const mediaSchema = z.object({ assetId: z.string().min(1), role: z.string().min(1) }).strict();
const shotSchema = z.object({
  prompt: z.string().trim().min(1).max(5000), modelId: z.string().min(1), duration: z.number().int().optional(), resolution: z.string().optional(), aspectRatio: z.string().optional(),
  media: z.array(mediaSchema).max(20).optional(), inputAssetIds: z.array(z.string().min(1)).max(20).optional(), inputRoles: z.array(z.string().min(1)).max(20).optional(), options: z.record(z.string(), z.unknown()).optional(),
}).strict();
const proposalSchema = z.object({ version: z.number().int().optional(), projectId: z.string().optional(), title: z.string().max(200).optional(), motionMode: z.string().max(100).optional(), note: z.string().max(1000).optional(), shots: z.array(shotSchema).min(1).max(20) }).strict();
export type DirectorProposal = z.infer<typeof proposalSchema>;

export function validateDirectorProposal(value: unknown): DirectorProposal {
  const proposal = proposalSchema.parse(value);
  for (const shot of proposal.shots) getModel(shot.modelId);
  return proposal;
}

function requestFor(proposalId: string, projectId: string, shot: DirectorProposal["shots"][number], index: number): GenerationDraft {
  const options = { ...(shot.options || {}), ...(shot.duration !== undefined ? { duration: shot.duration } : {}), ...(shot.resolution ? { resolution: shot.resolution } : {}), ...(shot.aspectRatio ? { aspectRatio: shot.aspectRatio } : {}) };
  return { projectId, idempotencyKey: `${proposalId}:${index}`, modelId: shot.modelId, prompt: shot.prompt, media: shot.media, inputAssetIds: shot.inputAssetIds, inputRoles: shot.inputRoles, options };
}

export function approveProposalJobs(store: ReturnType<typeof createStore>, proposalId: string, eligibleModels: Set<string>) {
  const proposal = store.getProposal(proposalId); if (!proposal) throw new Error("Proposal not found"); if (proposal.approved_at) throw new Error("Proposal is already approved.");
  const body = validateDirectorProposal(JSON.parse(proposal.proposal)); const requests = body.shots.map((shot, index) => requestFor(proposalId, proposal.project_id, shot, index));
  // Validate every shot before mutating approval state or creating any job.
  for (const request of requests) preflightGeneration(store, request, eligibleModels);
  store.approveProposal(proposalId);
  return requests.map((request) => queueGeneration(store, request, eligibleModels));
}
