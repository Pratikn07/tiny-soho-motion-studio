import type { JobEventType } from "./contract.js";

export type WorkerJobStatus = "submitting" | "submitted" | "running" | "downloading";

export type ClaimedCreativeJob = {
  id: string;
  status: WorkerJobStatus;
  provider_task_id: string | null;
  submit_attempt_id?: string | null;
};

export type ProviderTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";

/** Every status the worker writes; each is also written as `creative_studio_job_events.event_type`. */
export const JOB_UPDATE_STATUSES = [
  "submitting",
  "submitted",
  "running",
  "downloading",
  "completed",
  "failed",
  "canceled",
  "needs_attention",
] as const satisfies readonly JobEventType[];
export type JobUpdateStatus = (typeof JOB_UPDATE_STATUSES)[number];

export type JobPatch = {
  providerTaskId?: string;
  outputAssetId?: string;
  submitAttemptId?: string;
  errorCode?: string;
};

/** The job's lease moved to another worker (or the row changed); stop processing it. */
export class LeaseLostError extends Error {
  constructor() {
    super("creative_job_lease_lost");
    this.name = "LeaseLostError";
  }
}

const unlessLeaseLost = (error: unknown) => {
  if (error instanceof LeaseLostError) throw error;
};

export async function processClaimedJob(
  job: ClaimedCreativeJob,
  dependencies: {
    submit?: () => Promise<string>;
    newSubmitAttemptId?: () => string;
    /** Stores the provider task for the submit attempt, even if the lease moved on meanwhile. */
    recordSubmitted?: (submitAttemptId: string, providerTaskId: string) => Promise<void>;
    poll: (taskId: string) => Promise<{ status: ProviderTaskStatus; resultUrl?: string }>;
    ingest: (resultUrl: string) => Promise<{ outputAssetId: string }>;
    update: (status: JobUpdateStatus, patch?: JobPatch) => Promise<void>;
  },
) {
  if (job.status === "submitting" && !job.provider_task_id) {
    if (!dependencies.submit) {
      await dependencies.update("needs_attention", { errorCode: "provider_not_configured" });
      return;
    }
    // An earlier attempt reached the provider call and never recorded its task: submitting again could pay twice.
    if (job.submit_attempt_id) {
      await dependencies.update("needs_attention", { errorCode: "possible_duplicate_submit" });
      return;
    }
    const submitAttemptId = (dependencies.newSubmitAttemptId ?? (() => crypto.randomUUID()))();
    await dependencies.update("submitting", { submitAttemptId });
    let providerTaskId: string;
    try {
      providerTaskId = await dependencies.submit();
    } catch (error) {
      unlessLeaseLost(error);
      await dependencies.update("needs_attention", { errorCode: "provider_submit_failed" });
      return;
    }
    if (dependencies.recordSubmitted) await dependencies.recordSubmitted(submitAttemptId, providerTaskId);
    else await dependencies.update("submitted", { providerTaskId });
    return;
  }
  if (!job.provider_task_id) {
    await dependencies.update("needs_attention", { errorCode: "provider_task_missing" });
    return;
  }

  let provider;
  try {
    provider = await dependencies.poll(job.provider_task_id);
  } catch (error) {
    unlessLeaseLost(error);
    await dependencies.update("needs_attention", { errorCode: "provider_poll_failed" });
    return;
  }

  if (provider.status === "PENDING" || provider.status === "RUNNING") {
    await dependencies.update("running");
    return;
  }
  if (provider.status === "FAILED") {
    await dependencies.update("failed", { errorCode: "provider_task_failed" });
    return;
  }
  if (provider.status === "CANCELED") {
    await dependencies.update("canceled");
    return;
  }
  if (provider.status !== "SUCCEEDED" || !provider.resultUrl) {
    await dependencies.update("needs_attention", { errorCode: "provider_status_unknown" });
    return;
  }

  await dependencies.update("downloading");
  let result;
  try {
    result = await dependencies.ingest(provider.resultUrl);
  } catch (error) {
    unlessLeaseLost(error);
    await dependencies.update("needs_attention", { errorCode: "provider_result_ingest_failed" });
    return;
  }
  await dependencies.update("completed", { outputAssetId: result.outputAssetId });
}
