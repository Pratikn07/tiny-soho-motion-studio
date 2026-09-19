import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "@/lib/store";

describe("durable generation jobs", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it("returns the same job for the same idempotency key and payload", () => {
    const store = createStore(":memory:"); stores.push(store);
    const project = store.createProject("Test project");
    const first = store.createJob({ projectId: project.id, idempotencyKey: "tap-1", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    const second = store.createJob({ projectId: project.id, idempotencyKey: "tap-1", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("queued");
  });

  it("refuses an idempotency key reused with a changed payload", () => {
    const store = createStore(":memory:"); stores.push(store);
    const project = store.createProject("Test project");
    store.createJob({ projectId: project.id, idempotencyKey: "tap-1", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    expect(() => store.createJob({ projectId: project.id, idempotencyKey: "tap-1", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Different", inputAssetIds: [], options: {} })).toThrow(/idempotency/i);
  });
});
