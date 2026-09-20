import { afterEach, describe, expect, it } from "vitest";
import { queueGeneration } from "@/lib/generation";
import { resolveJobMedia } from "@/lib/job-media";
import { createStore } from "@/lib/store";

describe("queued job media resolution", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  const storeFor = () => { const db = createStore(":memory:"); stores.push(db); return db; };
  afterEach(() => stores.splice(0).forEach((db) => db.close()));

  it("resolves queued local image media into provider-safe values without exposing an asset path", async () => {
    const db = storeFor(); const project = db.createProject("Media job");
    const image = db.addAsset({ projectId: project.id, kind: "reference", name: "reference.png", mime: "image/png", path: "/owner-only/reference.png", width: 100, height: 100, duration: null, hash: "image", provenance: "{}" });
    const job = queueGeneration(db, { projectId: project.id, idempotencyKey: "image", modelId: "alibaba:wan2.7-r2v", prompt: "Use the reference image.", media: [{ assetId: image.id, role: "reference-image" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-r2v"]));

    const result = await resolveJobMedia(db, job, { readFile: async () => Buffer.from("image") });

    expect(result).toEqual({ ok: true, media: [{ role: "reference-image", mime: "image/png", locator: { kind: "data-url", value: "data:image/png;base64,aW1hZ2U=" } }] });
    expect(JSON.stringify(result)).not.toContain("/owner-only");
  });

  it("returns a pre-submit capability failure for a local reference video", async () => {
    const db = storeFor(); const project = db.createProject("Video job");
    const video = db.addAsset({ projectId: project.id, kind: "reference", name: "reference.mp4", mime: "video/mp4", path: "/owner-only/reference.mp4", width: 320, height: 320, duration: 2, hash: "video", provenance: "{}" });
    const job = db.createJob({ projectId: project.id, idempotencyKey: "video", modelId: "alibaba:wan2.7-r2v", task: "reference-to-video", prompt: "Use the reference video.", inputAssetIds: [video.id], options: { duration: 5, resolution: "720P", media: [{ assetId: video.id, role: "reference-video" }] } });

    await expect(resolveJobMedia(db, job)).resolves.toEqual({ ok: false, reason: "Local reference video is unavailable because free Singapore URL transport is not verified." });
  });

  it("uses a validated existing public URL attached to a project-owned media record", async () => {
    const db = storeFor(); const project = db.createProject("Public media job");
    const video = db.addAsset({ projectId: project.id, kind: "reference", name: "reference.mp4", mime: "video/mp4", path: "/owner-only/reference.mp4", width: 320, height: 320, duration: 2, hash: "video", provenance: "{}" });
    const job = queueGeneration(db, { projectId: project.id, idempotencyKey: "public-video", modelId: "alibaba:wan2.7-r2v", prompt: "Use the reference video.", media: [{ assetId: video.id, role: "reference-video", publicUrl: "https://media.example.test/reference.mp4" }], options: { duration: 5, resolution: "720P" } } as any, new Set(["alibaba:wan2.7-r2v"]));

    await expect(resolveJobMedia(db, job)).resolves.toEqual({ ok: true, media: [{ role: "reference-video", mime: "video/mp4", locator: { kind: "public-url", value: "https://media.example.test/reference.mp4" } }] });
    expect(JSON.parse(job.options).media).toEqual([{ assetId: video.id, role: "reference-video", publicUrl: "https://media.example.test/reference.mp4" }]);
  });
});
