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

  it("marks interrupted submissions as ambiguous and downstream work as needing attention", () => {
    const store = createStore(":memory:"); stores.push(store);
    const project = store.createProject("Test project");
    const submitting = store.createJob({ projectId: project.id, idempotencyKey: "submission", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    const downloading = store.createJob({ projectId: project.id, idempotencyKey: "download", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    store.updateJob(submitting.id, { status: "submitting" });
    store.updateJob(downloading.id, { status: "downloading" });

    store.reconcileInterruptedJobs();

    expect(store.getJob(submitting.id)?.status).toBe("submission_unknown");
    expect(store.getJob(downloading.id)?.status).toBe("needs_attention");
  });

  it("recovers interrupted media preparation to queued without treating it as provider submission", () => {
    const store = createStore(":memory:"); stores.push(store);
    const project = store.createProject("Test project");
    const queued = store.createJob({ projectId: project.id, idempotencyKey: "preparation", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });

    const preparing = store.claimNextJob();
    expect(preparing?.id).toBe(queued.id);
    expect(preparing?.status).toBe("preparing_media");
    store.reconcileInterruptedJobs();

    expect(store.getJob(queued.id)?.status).toBe("queued");
  });

  it("cancels only a still-queued job", () => {
    const store = createStore(":memory:"); stores.push(store);
    const project = store.createProject("Test project");
    const queued = store.createJob({ projectId: project.id, idempotencyKey: "queued", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    const submitted = store.createJob({ projectId: project.id, idempotencyKey: "submitted", modelId: "alibaba:wan2.7-i2v", task: "image-to-video", prompt: "Move", inputAssetIds: [], options: {} });
    store.updateJob(submitted.id, { status: "submitted" });

    expect(store.cancelQueuedJob(queued.id)?.status).toBe("canceled");
    expect(store.cancelQueuedJob(submitted.id)).toBeNull();
    expect(store.getJob(submitted.id)?.status).toBe("submitted");
  });
});
