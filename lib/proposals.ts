import { z } from "zod";
import { getModel } from "./models";
import { preflightGeneration, queueGeneration, type GenerationDraft } from "./generation";
import type { createStore } from "./store";
import type { CreativeEvidence, KnowledgeStatus } from "./knowledge";

const mediaSchema = z.object({ assetId: z.string().min(1), role: z.string().min(1) }).strict();
const shotSchema = z.object({
  prompt: z.string().trim().min(1).max(5000), modelId: z.string().min(1), duration: z.number().int().optional(), resolution: z.string().optional(), aspectRatio: z.string().optional(),
  media: z.array(mediaSchema).max(20).optional(), evidenceRefs: z.array(z.string().min(3).max(400)).max(8).optional(), inputAssetIds: z.array(z.string().min(1)).max(20).optional(), inputRoles: z.array(z.string().min(1)).max(20).optional(), options: z.record(z.string(), z.unknown()).optional(),
}).strict();
const evidenceItemSchema = z.object({ source: z.enum(["technique", "segment", "shot", "carousel-slide", "tool-guide"]), sourceId: z.string().min(1), title: z.string().max(300), summary: z.string().max(2000), score: z.number().finite(), confidence: z.number().finite().nullable(), status: z.string().max(100).optional(), evidenceType: z.string().max(100).optional(), scoreComponents: z.record(z.string(), z.number().finite()).optional() }).strict();
const knowledgeSchema = z.object({ status: z.enum(["available", "no-match", "not-configured", "unavailable"]), evidence: z.array(evidenceItemSchema).max(8), warning: z.string().max(500).optional() }).strict();
const proposalSchema = z.object({ version: z.number().int().optional(), projectId: z.string().optional(), title: z.string().max(200).optional(), motionMode: z.string().max(100).optional(), note: z.string().max(1000).optional(), evidence: knowledgeSchema.optional(), shots: z.array(shotSchema).min(1).max(20) }).strict();
export type DirectorProposal = z.infer<typeof proposalSchema>;
export type ProposalKnowledge = { status: KnowledgeStatus; evidence: CreativeEvidence[]; warning?: string };
type ProposalValidationScope = { projectId: string; allowedAssetIds: Set<string>; allowedEvidenceRefs?: Set<string> };

export function validateDirectorProposal(value: unknown, scope?: ProposalValidationScope): DirectorProposal {
  const proposal = proposalSchema.parse(value);
  if (scope && proposal.projectId !== undefined && proposal.projectId !== scope.projectId) throw new Error("Director proposal is for a different project.");
  for (const shot of proposal.shots) getModel(shot.modelId);
  if (scope) {
    for (const shot of proposal.shots) {
      const assetIds = [...(shot.media || []).map((media) => media.assetId), ...(shot.inputAssetIds || [])];
      if (assetIds.some((assetId) => !scope.allowedAssetIds.has(assetId))) throw new Error("Director proposal references an asset that is not available in this project.");
      if (shot.evidenceRefs?.some((reference) => !scope.allowedEvidenceRefs?.has(reference))) throw new Error("Director proposal references evidence that is not available in this retrieval bundle.");
    }
  }
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
