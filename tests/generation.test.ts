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

  it("preserves a Wan 2.7 R2V per-reference voice association without making it a standalone media item", () => {
    const store = storeFor(); const project = store.createProject("Voice reference");
    const reference = image(store, project.id); const voice = store.addAsset({ projectId: project.id, kind: "voice", name: "voice.mp3", mime: "audio/mpeg", path: "/tmp/voice.mp3", width: null, height: null, duration: 3, sizeBytes: 1024, hash: "voice", provenance: "{}" });
    const job = queueGeneration(store, {
      projectId: project.id,
      idempotencyKey: "voice",
      modelId: "alibaba:wan2.7-r2v",
      prompt: "The reference image speaks clearly.",
      media: [{ assetId: reference.id, role: "reference-image", referenceVoiceAssetId: voice.id, referenceVoicePublicUrl: "https://media.example.test/voice.mp3" }] as any,
      options: { duration: 5, resolution: "720P" },
    }, new Set(["alibaba:wan2.7-r2v"]));

    expect(JSON.parse(job.inputAssetIds)).toEqual([reference.id]);
    expect(JSON.parse(job.options).media).toEqual([{ assetId: reference.id, role: "reference-image", referenceVoiceAssetId: voice.id, referenceVoicePublicUrl: "https://media.example.test/voice.mp3" }]);
  });

  it("rejects a supplied URL with query data so it cannot become a browser-visible secret", () => {
    const store = storeFor(); const project = store.createProject("Public URL safety");
    const reference = store.addAsset({ projectId: project.id, kind: "reference", name: "reference.mp4", mime: "video/mp4", path: "/tmp/reference.mp4", width: 320, height: 320, duration: 2, hash: "reference", provenance: "{}" });

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "query-url", modelId: "alibaba:wan2.7-r2v", prompt: "Use the reference video.", media: [{ assetId: reference.id, role: "reference-video", publicUrl: "https://media.example.test/reference.mp4?token=secret" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-r2v"]))).toThrow(/safe HTTPS URL/i);
  });

  it("rejects an untransportable local URL-required input before queueing a job", () => {
    const store = storeFor(); const project = store.createProject("Transport preflight");
    const reference = store.addAsset({ projectId: project.id, kind: "reference", name: "reference.mp4", mime: "video/mp4", path: "/tmp/reference.mp4", width: 320, height: 320, duration: 2, hash: "reference", provenance: "{}" });

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "no-transport", modelId: "alibaba:wan2.7-r2v", prompt: "Use the reference video.", media: [{ assetId: reference.id, role: "reference-video" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-r2v"]))).toThrow(/reference video.*transport is not verified/i);
    expect(store.listJobs(project.id)).toHaveLength(0);
  });

  it("enforces Wan 3 aggregate input-video and output duration before a job is queued", () => {
    const store = storeFor(); const project = store.createProject("Video duration");
    const videos = Array.from({ length: 5 }, (_, index) => store.addAsset({ projectId: project.id, kind: "reference", name: `reference-${index}.mp4`, mime: "video/mp4", path: `/tmp/reference-${index}.mp4`, width: 320, height: 320, duration: 3, sizeBytes: 1024, hash: `video-${index}`, provenance: "{}" }));
    const media = videos.map((video, index) => ({ assetId: video.id, role: "reference-video" as const, publicUrl: `https://media.example.test/reference-${index}.mp4` }));

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "duration-ok", modelId: "alibaba:wan3-video", prompt: "Extend the reference videos.", media, options: { duration: 15, resolution: "720P" } }, new Set(["alibaba:wan3-video"]))).not.toThrow();
    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "duration-over", modelId: "alibaba:wan3-video", prompt: "Extend the reference videos.", media, options: { duration: 16, resolution: "720P" } }, new Set(["alibaba:wan3-video"]))).toThrow(/input video.*output duration.*30/i);
  });

  it("rejects a Wan 2.7 R2V reference voice outside its documented duration range", () => {
    const store = storeFor(); const project = store.createProject("Voice duration");
    const reference = image(store, project.id); const voice = store.addAsset({ projectId: project.id, kind: "voice", name: "voice.wav", mime: "audio/wav", path: "/tmp/voice.wav", width: null, height: null, duration: 0.5, sizeBytes: 1024, hash: "voice", provenance: "{}" });

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "short-voice", modelId: "alibaba:wan2.7-r2v", prompt: "The reference image speaks.", media: [{ assetId: reference.id, role: "reference-image", referenceVoiceAssetId: voice.id }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-r2v"]))).toThrow(/reference voice.*1.*10/i);
  });

  it("rejects I2V driving-audio and first-clip metadata outside the documented ranges before transport", () => {
    const store = storeFor(); const project = store.createProject("I2V media limits"); const start = image(store, project.id);
    const shortAudio = store.addAsset({ projectId: project.id, kind: "audio", name: "short.mp3", mime: "audio/mpeg", path: "/tmp/short.mp3", width: null, height: null, duration: 1, sizeBytes: 1024, hash: "audio", provenance: "{}" });
    const longClip = store.addAsset({ projectId: project.id, kind: "video", name: "long.mp4", mime: "video/mp4", path: "/tmp/long.mp4", width: 320, height: 320, duration: 11, sizeBytes: 1024, hash: "video", provenance: "{}" });

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "short-audio", modelId: "alibaba:wan2.7-i2v", prompt: "Animate with sound.", media: [{ assetId: start.id, role: "start-image" }, { assetId: shortAudio.id, role: "driving-audio", publicUrl: "https://media.example.test/short.mp3" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/driving audio.*2.*30/i);
    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "long-clip", modelId: "alibaba:wan2.7-i2v", prompt: "Continue the clip.", media: [{ assetId: longClip.id, role: "first-clip", publicUrl: "https://media.example.test/long.mp4" }], options: { duration: 15, resolution: "720P" } }, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/first clip.*2.*10/i);
  });

  it("rejects undersized video-model image inputs before they are inlined", () => {
    const store = storeFor(); const project = store.createProject("Image limits");
    const tooSmall = store.addAsset({ projectId: project.id, kind: "layer", name: "small.png", mime: "image/png", path: "/tmp/small.png", width: 239, height: 300, duration: null, sizeBytes: 1024, hash: "small", provenance: "{}" });

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "small-image", modelId: "alibaba:wan2.7-i2v", prompt: "Animate.", media: [{ assetId: tooSmall.id, role: "start-image" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan2.7-i2v"]))).toThrow(/image dimensions.*provider limit/i);
  });

  it("rejects a non-WAV/MP3 Wan 3 reference-audio asset before transport", () => {
    const store = storeFor(); const project = store.createProject("Reference audio MIME");
    const unsupportedAudio = store.addAsset({ projectId: project.id, kind: "audio", name: "reference.ogg", mime: "audio/ogg", path: "/tmp/reference.ogg", width: null, height: null, duration: 3, sizeBytes: 1024, hash: "ogg", provenance: "{}" });

    expect(() => queueGeneration(store, { projectId: project.id, idempotencyKey: "ogg-audio", modelId: "alibaba:wan3-video", prompt: "Use this audio reference.", media: [{ assetId: unsupportedAudio.id, role: "reference-audio", publicUrl: "https://media.example.test/reference.ogg" }], options: { duration: 5, resolution: "720P" } }, new Set(["alibaba:wan3-video"]))).toThrow(/reference audio must be WAV or MP3/i);
    expect(store.listJobs(project.id)).toHaveLength(0);
  });
});
