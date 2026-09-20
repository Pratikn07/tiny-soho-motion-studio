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

type SynchronizableJob = {
  id: string;
  status: StudioJobStatus;
  providerTaskId?: string | null;
};

type ProviderStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
type JobPatch = Partial<Pick<SynchronizableJob, "status">> & {
  outputAssetId?: string;
  errorCode?: string;
  errorMessage?: string;
};

const terminalStatuses = new Set<StudioJobStatus>(["completed", "failed", "needs_attention", "canceled"]);

export async function synchronizeJob<T extends SynchronizableJob>(
  job: T,
  dependencies: {
    checkTask: (providerTaskId: string) => Promise<{ status: ProviderStatus; outputUrl?: string }>;
    ingestResult: (outputUrl: string) => Promise<{ outputAssetId: string }>;
    claimDownload?: () => Promise<boolean>;
    update: (patch: JobPatch) => Promise<unknown>;
  },
) {
  if (terminalStatuses.has(job.status)) return job;
  if (job.status === "downloading") return job;
  if (!job.providerTaskId) {
    return dependencies.update({
      status: "needs_attention",
      errorCode: "provider_task_missing",
      errorMessage: "Provider task ID is unavailable.",
    });
  }

  let provider;
  try {
    provider = await dependencies.checkTask(job.providerTaskId);
  } catch {
    return dependencies.update({
      status: "needs_attention",
      errorCode: "provider_status_unknown",
      errorMessage: "Provider status could not be confirmed.",
    });
  }

  if (provider.status === "PENDING" || provider.status === "RUNNING") {
    return dependencies.update({ status: "running" });
  }
  if (provider.status === "FAILED") {
    return dependencies.update({ status: "failed", errorCode: "provider_failed", errorMessage: "Video provider reported a failure." });
  }
  if (provider.status === "CANCELED") {
    return dependencies.update({ status: "canceled", errorCode: "provider_canceled", errorMessage: "Video provider canceled the task." });
  }
  if (provider.status === "UNKNOWN" || !provider.outputUrl) {
    return dependencies.update({ status: "needs_attention", errorCode: "provider_status_unknown", errorMessage: "Provider result needs review." });
  }

  if (dependencies.claimDownload && !await dependencies.claimDownload()) return job;
  try {
    const result = await dependencies.ingestResult(provider.outputUrl);
    return dependencies.update({ status: "completed", outputAssetId: result.outputAssetId });
  } catch {
    return dependencies.update({
      status: "needs_attention",
      errorCode: "result_ingestion_failed",
      errorMessage: "Provider result needs review before retrying.",
    });
  }
}
