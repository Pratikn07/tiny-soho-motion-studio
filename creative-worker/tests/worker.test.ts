import { describe, expect, it } from "vitest";

import { jobLeasePatch } from "../src/worker.js";

describe("Creative worker job updates", () => {
  it("keeps the claim lease while ingesting a completed video", () => {
    expect(jobLeasePatch("downloading")).toEqual({});
    expect(jobLeasePatch("completed")).toEqual({
      worker_lease_id: null,
      worker_lease_expires_at: null,
    });
  });
});
