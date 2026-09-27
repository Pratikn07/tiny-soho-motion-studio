import { describe, expect, it } from "vitest";
import { processClaimedJob } from "../src/process-job.js";

describe("Creative worker", () => {
  it("does not resubmit when provider output ingestion fails", async () => {
    const updates: string[] = [];

    await processClaimedJob(
      { id: "job-1", status: "submitted", provider_task_id: "task-1" },
      {
        poll: async () => ({ status: "SUCCEEDED" as const, resultUrl: "https://provider.example/video.mp4" }),
        ingest: async () => { throw new Error("storage unavailable"); },
        update: async (status: "submitted" | "running" | "downloading" | "completed" | "failed" | "canceled" | "needs_attention") => { updates.push(status); },
      },
    );

    expect(updates).toEqual(["downloading", "needs_attention"]);
  });

  it("submits a newly claimed job once and records the provider task", async () => {
    const updates: Array<{ status: string; providerTaskId?: string }> = [];

    await processClaimedJob(
      { id: "job-2", status: "submitting", provider_task_id: null },
      {
        submit: async () => "task-2",
        poll: async () => ({ status: "UNKNOWN" as const }),
        ingest: async () => ({ outputAssetId: "asset-1" }),
        update: async (status, providerTaskId) => { updates.push({ status, providerTaskId }); },
      },
    );

    expect(updates).toEqual([{ status: "submitted", providerTaskId: "task-2" }]);
  });
});
