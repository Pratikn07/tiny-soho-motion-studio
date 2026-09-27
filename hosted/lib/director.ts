import { createHash } from "node:crypto";

import { z } from "zod";

import { StudioError } from "@/lib/errors";
import { generationFingerprint } from "@/lib/generation";
import type { StudioDirectorRequest } from "@/lib/creative-suite";
import {
  getVideoModelContract,
  preflightVideoGeneration,
  type GenerationMedia,
  type ModelAcknowledgement,
} from "@/lib/video-catalog";

const mediaRoleSchema = z.enum([
  "first_frame", "last_frame", "mask_image", "reference_image", "reference_video",
  "source_video", "driving_video", "driving_audio", "first_clip",
]);

const directorMediaSchema = z.object({
  assetId: z.string().uuid(),
  role: mediaRoleSchema,
  ordinal: z.number().int().positive().optional(),
}).strict();

const directorShotSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(5000),
  media: z.array(directorMediaSchema).max(20).default([]),
  options: z.record(z.unknown()).default({}),
}).strict();

export const createDirectorDraftSchema = z.object({
  projectId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  brief: z.string().trim().min(1).max(5000),
}).strict();

export const directorProposalSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).optional(),
  shots: z.array(directorShotSchema).min(1).max(20),
}).strict();

export type DirectorDraftInput = z.infer<typeof createDirectorDraftSchema>;
export type DirectorProposalSnapshot = z.infer<typeof directorProposalSnapshotSchema>;

export type DirectorProposalScope = {
  projectId: string;
  assets: Array<{ id: string; projectId: string }>;
};

export type DirectorApprovalJob = {
  idempotencyKey: string;
  fingerprint: string;
  modelId: string;
  task: string;
  prompt: string;
  inputAssets: GenerationMedia[];
  options: Record<string, unknown>;
};

export const publicDirectorRequest = (request: StudioDirectorRequest) => ({
  id: request.id,
  projectId: request.project_id,
  brief: request.brief,
  status: request.status,
  errorCode: request.error_code,
  errorMessage: request.error_message,
  createdAt: request.created_at,
  updatedAt: request.updated_at,
});

const invalid = (code: string, message: string): never => {
  throw new StudioError(400, code, message);
};

export function directorRequestFingerprint(input: Pick<DirectorDraftInput, "projectId" | "brief">) {
  return generationFingerprint({ projectId: input.projectId, brief: input.brief });
}

export function directorProposalFingerprint(snapshot: DirectorProposalSnapshot) {
  return generationFingerprint(snapshot);
}

export function deterministicDirectorJobKey(proposalId: string, shotIndex: number) {
  const hash = createHash("sha256").update(`${proposalId}:${shotIndex}`).digest("hex");
  const variant = (Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80;
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant.toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

const parseSnapshot = (value: unknown): DirectorProposalSnapshot => {
  const parsed = directorProposalSnapshotSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return invalid("invalid_director_proposal", "Director proposal is not a valid Studio draft.");
};

const placeholderAcknowledgements = (snapshot: DirectorProposalSnapshot): ModelAcknowledgement[] => (
  snapshot.shots.flatMap((shot) => {
    const contract = getVideoModelContract(shot.modelId);
    return contract ? [{ modelId: contract.id, contractVersion: contract.contractVersion }] : [];
  })
);

export function validateDirectorProposal(value: unknown, scope: DirectorProposalScope): DirectorProposalSnapshot {
  const snapshot = parseSnapshot(value);
  if (snapshot.projectId !== scope.projectId) {
    invalid("director_project_mismatch", "Director proposal is for a different project.");
  }

  const assetIds = new Set(scope.assets
    .filter((asset) => asset.projectId === scope.projectId)
    .map((asset) => asset.id));
  for (const shot of snapshot.shots) {
    if (!getVideoModelContract(shot.modelId)) {
      invalid("unsupported_model", "Director proposal selects a model outside the Studio catalogue.");
    }
    if (shot.media.some((media) => !assetIds.has(media.assetId))) {
      invalid("director_asset_not_owned", "Director proposal references an asset outside the owned project asset set.");
    }
  }

  const acknowledgements = placeholderAcknowledgements(snapshot);
  for (const shot of snapshot.shots) {
    preflightVideoGeneration({
      modelId: shot.modelId,
      prompt: shot.prompt,
      media: shot.media,
      options: shot.options,
      acknowledgements,
    });
  }
  return snapshot;
}

export function buildDirectorApprovalJobs(
  proposalId: string,
  value: unknown,
  scope: DirectorProposalScope & { acknowledgements: readonly ModelAcknowledgement[] },
): DirectorApprovalJob[] {
  const snapshot = validateDirectorProposal(value, scope);
  return snapshot.shots.map((shot, index) => {
    const prepared = preflightVideoGeneration({
      modelId: shot.modelId,
      prompt: shot.prompt,
      media: shot.media,
      options: shot.options,
      acknowledgements: scope.acknowledgements,
    });
    return {
      idempotencyKey: deterministicDirectorJobKey(proposalId, index),
      fingerprint: generationFingerprint({
        modelId: prepared.contract.id,
        contractVersion: prepared.contract.contractVersion,
        prompt: prepared.prompt,
        media: prepared.media,
        options: prepared.options,
      }),
      modelId: prepared.contract.id,
      task: prepared.contract.task,
      prompt: prepared.prompt,
      inputAssets: prepared.media,
      options: prepared.options,
    };
  });
}

type DirectorDraftRepository = {
  getProject: (projectId: string) => Promise<{ id: string } | null>;
  findDirectorRequestByIdempotency: (projectId: string, idempotencyKey: string) => Promise<StudioDirectorRequest | null>;
  createDirectorRequest: (input: DirectorDraftInput & { id: string; fingerprint: string }) => Promise<StudioDirectorRequest>;
};

export async function createDirectorDraft(input: DirectorDraftInput, repository: DirectorDraftRepository) {
  const parsed = createDirectorDraftSchema.parse(input);
  const project = await repository.getProject(parsed.projectId);
  if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");
  const fingerprint = directorRequestFingerprint(parsed);
  const existing = await repository.findDirectorRequestByIdempotency(parsed.projectId, parsed.idempotencyKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new StudioError(409, "idempotency_conflict", "This idempotency key belongs to a different Director brief.");
    }
    return existing;
  }
  return repository.createDirectorRequest({ ...parsed, id: crypto.randomUUID(), fingerprint });
}
