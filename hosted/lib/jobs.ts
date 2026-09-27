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
  status: string;
};

export async function createOrGetJob<T extends ExistingJob>(
  repository: { find: () => Promise<T | null>; create: () => Promise<T> },
  input: { idempotencyKey: string; fingerprint: string },
) {
  const replay = (existing: T) => {
    if (existing.fingerprint !== input.fingerprint) {
      throw new StudioError(
        409,
        "idempotency_conflict",
        "This idempotency key belongs to a different generation request.",
      );
    }
    return { job: existing, created: false };
  };
  const existing = await repository.find();
  if (existing) return replay(existing);
  try {
    return { job: await repository.create(), created: true };
  } catch (error) {
    // A concurrent request or a lost insert response may already have saved it.
    const recovered = await repository.find();
    if (recovered) return replay(recovered);
    throw error;
  }
}
