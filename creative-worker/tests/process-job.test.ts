import { describe, expect, it } from "vitest";
import { LeaseLostError, processClaimedJob, type JobPatch, type JobUpdateStatus } from "../src/process-job.js";

const recorder = () => {
  const updates: Array<{ status: JobUpdateStatus } & JobPatch> = [];
  return { updates, update: async (status: JobUpdateStatus, patch: JobPatch = {}) => { updates.push({ status, ...patch }); } };
};

describe("Creative worker", () => {
  it("does not resubmit when provider output ingestion fails", async () => {
    const { updates, update } = recorder();

    await processClaimedJob(
      { id: "job-1", status: "submitted", provider_task_id: "task-1" },
      {
        poll: async () => ({ status: "SUCCEEDED" as const, resultUrl: "https://provider.example/video.mp4" }),
        ingest: async () => { throw new Error("storage unavailable"); },
        update,
      },
    );

    expect(updates.map((entry) => entry.status)).toEqual(["downloading", "needs_attention"]);
    expect(updates[1].errorCode).toBe("provider_result_ingest_failed");
  });

  it("records a submit attempt before calling the provider, then its task", async () => {
    const { updates, update } = recorder();
    const recorded: Array<[string, string]> = [];
    let submitted = 0;

    await processClaimedJob(
      { id: "job-2", status: "submitting", provider_task_id: null, submit_attempt_id: null },
      {
        submit: async () => {
          submitted += 1;
          expect(updates).toEqual([{ status: "submitting", submitAttemptId: "attempt-1" }]);
          return "task-2";
        },
        newSubmitAttemptId: () => "attempt-1",
        recordSubmitted: async (attemptId, taskId) => { recorded.push([attemptId, taskId]); },
        poll: async () => ({ status: "UNKNOWN" as const }),
        ingest: async () => ({ outputAssetId: "asset-1" }),
        update,
      },
    );

    expect(submitted).toBe(1);
    expect(recorded).toEqual([["attempt-1", "task-2"]]);
  });

  it("flags a possible duplicate instead of submitting again", async () => {
    const { updates, update } = recorder();
    let submitted = 0;

    await processClaimedJob(
      { id: "job-3", status: "submitting", provider_task_id: null, submit_attempt_id: "attempt-0" },
      {
        submit: async () => { submitted += 1; return "task-3"; },
        poll: async () => ({ status: "RUNNING" as const }),
        ingest: async () => ({ outputAssetId: "asset-1" }),
        update,
      },
    );

    expect(submitted).toBe(0);
    expect(updates).toEqual([{ status: "needs_attention", errorCode: "possible_duplicate_submit" }]);
  });

  it("marks a failed submit for attention", async () => {
    const { updates, update } = recorder();

    await processClaimedJob(
      { id: "job-4", status: "submitting", provider_task_id: null },
      {
        submit: async () => { throw new Error("alibaba_InvalidParameter"); },
        newSubmitAttemptId: () => "attempt-4",
        poll: async () => ({ status: "RUNNING" as const }),
        ingest: async () => ({ outputAssetId: "asset-1" }),
        update,
      },
    );

    expect(updates.map((entry) => entry.status)).toEqual(["submitting", "needs_attention"]);
    expect(updates[1].errorCode).toBe("provider_submit_failed");
  });

  it("stops at a lost lease without writing anything else", async () => {
    const { updates, update } = recorder();

    await expect(processClaimedJob(
      { id: "job-5", status: "submitted", provider_task_id: "task-5" },
      {
        poll: async () => { throw new LeaseLostError(); },
        ingest: async () => ({ outputAssetId: "asset-1" }),
        update,
      },
    )).rejects.toBeInstanceOf(LeaseLostError);

    expect(updates).toEqual([]);
  });
});
