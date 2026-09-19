import { afterEach, describe, expect, it } from "vitest";
import { getModel } from "@/lib/models";
import { createStore } from "@/lib/store";
import { inferTask, preflightGeneration, queueGeneration } from "@/lib/generation";

describe("shared generation preflight", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  const storeFor = () => { const store = createStore(":memory:"); stores.push(store); return store; };
  const image = (store: ReturnType<typeof createStore>, projectId: string, mime = "image/png") => store.addAsset({ projectId, kind: "layer", name: "frame", mime, path: "/tmp/frame", width: 1080, height: 1440, duration: null, hash: "fixture", provenance: "{}" });
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it("infers a task from the selected model and supplied media", () => {
    const wan3 = getModel("alibaba:wan3-video");
    expect(inferTask(wan3, [])).toBe("text-to-video");
    expect(inferTask(wan3, [{ assetId: "start", role: "start-image" }])).toBe("image-to-video");
    expect(inferTask(wan3, [{ assetId: "start", role: "start-image" }, { assetId: "end", role: "end-image" }])).toBe("image-to-video");
    expect(inferTask(wan3, [{ assetId: "reference", role: "reference-image" }])).toBe("reference-to-video");
  });

  it("fails a missing Wan 2.7 start image before creating a durable job", () => {
    const store = storeFor(); const project = store.createProject("Preflight");
    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "missing", modelId: "alibaba:wan2.7-i2v", prompt: "Move", media: [], options: {} }, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/start image|required/i);
    expect(store.listJobs(project.id)).toHaveLength(0);
  });

  it("rejects a cross-project frame and an image role backed by a non-image asset", () => {
    const store = storeFor(); const project = store.createProject("Destination"); const otherProject = store.createProject("Other"); const foreignAsset = image(store, otherProject.id); const audioAsset = image(store, project.id, "audio/mpeg");
    expect(() => preflightGeneration(store, { projectId: project.id, idempotencyKey: "foreign", modelId: "alibaba:wan2.7-i2v", prompt: "Move", media: [{ assetId: foreignAsset.id, role: "start-image" }], options: {} }, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/same project/i);
    expect(() => preflightGeneration(store, { projectId: project.id, idempotencyKey: "audio", modelId: "alibaba:wan2.7-i2v", prompt: "Move", media: [{ assetId: audioAsset.id, role: "start-image" }], options: {} }, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/image/i);
  });

  it("queues one normalized request and preserves its inferred media roles", () => {
    const store = storeFor(); const project = store.createProject("Ready"); const start = image(store, project.id); const end = image(store, project.id);
    const job = queueGeneration(store, { projectId: project.id, idempotencyKey: "ready", modelId: "alibaba:wan2.7-i2v", prompt: "Move", media: [{ assetId: start.id, role: "start-image" }, { assetId: end.id, role: "end-image" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-i2v"]));
    expect(job.task).toBe("image-to-video"); expect(JSON.parse(job.inputAssetIds)).toEqual([start.id, end.id]); expect(JSON.parse(job.options).media.map((media: { role: string }) => media.role)).toEqual(["start-image", "end-image"]);
  });
});
