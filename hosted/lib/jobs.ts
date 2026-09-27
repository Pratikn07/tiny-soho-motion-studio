import { StudioError } from "@/lib/errors";

export type StudioJobStatus =
  | "queued"
  | "submitting"
  | "submitted"
  | "running"
  | "downloading"
  | "completed"
  | "failed"
  | "needs_attention"
  | "canceled";

type ExistingJob = {
  id: string;
  fingerprint: string;
  status: StudioJobStatus;
};

export async function createOrGetJob<T extends ExistingJob>(
  repository: { find: () => Promise<T | null>; create: () => Promise<T> },
  input: { idempotencyKey: string; fingerprint: string },
) {
  const existing = await repository.find();
  if (existing) {
    if (existing.fingerprint !== input.fingerprint) {
      throw new StudioError(409, "idempotency_conflict", "This idempotency key belongs to a different generation request.");
    }
    return { job: existing, created: false };
  }
  return { job: await repository.create(), created: true };
}
