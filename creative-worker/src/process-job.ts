export type WorkerJobStatus = "submitting" | "submitted" | "running" | "downloading";

export type ClaimedCreativeJob = {
  id: string;
  status: WorkerJobStatus;
  provider_task_id: string | null;
};

export type ProviderTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";

export async function processClaimedJob(
  job: ClaimedCreativeJob,
  dependencies: {
    submit?: () => Promise<string>;
    poll: (taskId: string) => Promise<{ status: ProviderTaskStatus; resultUrl?: string }>;
    ingest: (resultUrl: string) => Promise<{ outputAssetId: string }>;
    update: (status: "submitted" | "running" | "downloading" | "completed" | "failed" | "canceled" | "needs_attention", providerTaskId?: string, outputAssetId?: string) => Promise<void>;
  },
) {
  if (job.status === "submitting") {
    if (!dependencies.submit) {
      await dependencies.update("needs_attention");
      return;
    }
    try {
      await dependencies.update("submitted", await dependencies.submit());
    } catch {
      await dependencies.update("needs_attention");
    }
    return;
  }
  if (!job.provider_task_id) {
    await dependencies.update("needs_attention");
    return;
  }

  let provider;
  try {
    provider = await dependencies.poll(job.provider_task_id);
  } catch {
    await dependencies.update("needs_attention");
    return;
  }

  if (provider.status === "PENDING" || provider.status === "RUNNING") {
    await dependencies.update("running");
    return;
  }
  if (provider.status === "FAILED") {
    await dependencies.update("failed");
    return;
  }
  if (provider.status === "CANCELED") {
    await dependencies.update("canceled");
    return;
  }
  if (provider.status !== "SUCCEEDED" || !provider.resultUrl) {
    await dependencies.update("needs_attention");
    return;
  }

  await dependencies.update("downloading");
  try {
    const result = await dependencies.ingest(provider.resultUrl);
    await dependencies.update("completed", undefined, result.outputAssetId);
  } catch {
    await dependencies.update("needs_attention");
  }
}
