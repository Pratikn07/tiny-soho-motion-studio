import { describe, expect, it } from "vitest";
import { createOrGetJob, synchronizeJob } from "@/lib/jobs";

describe("hosted Studio jobs", () => {
  it("returns the original job for an identical idempotency replay", async () => {
    const existing = { id: "job-1", fingerprint: "same", status: "submitted" as const };

    await expect(
      createOrGetJob(
        { find: async () => existing, create: async () => { throw new Error("must not create"); } },
        { idempotencyKey: "ce82a151-4c9d-47b0-a112-48fa8bcbe9cf", fingerprint: "same" },
      ),
    ).resolves.toEqual({ job: existing, created: false });
  });

  it("rejects reuse of an idempotency key with a different generation request", async () => {
    await expect(
      createOrGetJob(
        { find: async () => ({ id: "job-1", fingerprint: "old", status: "submitted" as const }), create: async () => { throw new Error("must not create"); } },
        { idempotencyKey: "ce82a151-4c9d-47b0-a112-48fa8bcbe9cf", fingerprint: "new" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("marks provider success as needs_attention when result ingestion fails", async () => {
    const result = await synchronizeJob(
      { id: "job-1", status: "submitted", providerTaskId: "provider-1" },
      {
        checkTask: async () => ({ status: "SUCCEEDED" as const, outputUrl: "https://provider.test/result.mp4" }),
        ingestResult: async () => { throw new Error("storage unavailable"); },
        update: async (patch) => ({ id: "job-1", ...patch }),
      },
    );

    expect(result).toMatchObject({ status: "needs_attention" });
  });

  it("does not query or ingest again after another request claimed result downloading", async () => {
    const job = { id: "job-1", status: "downloading" as const, providerTaskId: "provider-1" };

    await expect(synchronizeJob(job, {
      checkTask: async () => { throw new Error("must not poll"); },
      ingestResult: async () => { throw new Error("must not ingest"); },
      update: async () => { throw new Error("must not update"); },
    })).resolves.toEqual(job);
  });
});
