import { describe, expect, it } from "vitest";
import { createStore, toPublicJob } from "@/lib/store";

describe("public jobs", () => {
  it("removes internal lineage from browser-facing job options", () => {
    const db = createStore(":memory:");
    try {
      const project = db.createProject("Public job");
      const job = db.createJob({ projectId: project.id, idempotencyKey: "one", modelId: "alibaba:wan3-video", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: { duration: 3, internalProvenance: { sourceAssetId: "asset_private" } } });
      expect(JSON.parse(toPublicJob(job).options)).toEqual({ duration: 3 });
    } finally { db.close(); }
  });
});
