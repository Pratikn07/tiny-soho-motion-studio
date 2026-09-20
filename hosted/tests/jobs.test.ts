import { describe, expect, it } from "vitest";
import { createOrGetJob } from "@/lib/jobs";

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
});
