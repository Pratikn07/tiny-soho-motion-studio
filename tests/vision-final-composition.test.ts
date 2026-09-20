import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { MotionPackageV2 } from "@/lib/vision/motion-package-v2";
import { motionPackageV2Fingerprint } from "@/lib/vision/motion-package-v2";
import { createSafeMotionPlan } from "@/lib/safe-motion/planner";
import { createStore } from "@/lib/store";

describe("persistent final typography composition", () => {
  const stores: ReturnType<typeof createStore>[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    stores.splice(0).forEach((db) => db.close());
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  function fixture(sourceProvenance: Record<string, unknown> = { source: "vision-safe-motion", vision: { kind: "source-image" } }) {
    const db = createStore(":memory:");
    stores.push(db);
    const project = db.createProject("Final composition");
    const source = db.addAsset({ projectId: project.id, kind: "source-image", name: "source.png", mime: "image/png", path: "/tmp/source.png", width: 1080, height: 1440, duration: null, hash: "source", provenance: JSON.stringify(sourceProvenance) });
    const plate = db.addAsset({ projectId: project.id, kind: "generation-plate", name: "plate.png", mime: "image/png", path: "/tmp/plate.png", width: 1080, height: 1440, duration: null, hash: "plate", provenance: JSON.stringify({ source: "vision-safe-motion", vision: { kind: "generation-plate", producer: "generation-plate-builder", plateMode: "original-with-protected-text", plateTextRemoved: false } }) });
    const overlay = db.addAsset({ projectId: project.id, kind: "typography-overlay", name: "typography.png", mime: "image/png", path: "/tmp/typography.png", width: 1080, height: 1440, duration: null, hash: "overlay", provenance: JSON.stringify({ source: "vision-safe-motion", sourceAssetId: source.id, vision: { kind: "typography-overlay", producer: "overlay-builder" } }) });
    const pkg = {
      version: "2",
      projectId: project.id,
      sourceAssetId: source.id,
      generationPlateAssetId: plate.id,
      typographyOverlayAssetId: overlay.id,
      plateTextRemoved: false,
      analysis: { ocr: { provider: "PaddleOCR", model: "PP-OCRv5_mobile", regions: [] } },
      plan: createSafeMotionPlan({
        sourceArtifactId: source.id,
        plateArtifactId: plate.id,
        plateMode: "original-with-protected-text",
        subject: { id: "subject", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
        typography: [],
        requested: { subject: { x: 0.05, y: 0 }, camera: { x: 0, y: 0 } },
      }),
      generation: { modelId: "alibaba:wan3-video", duration: 3, resolution: "720P", aspectRatio: "3:4", prompt: "Motion only", audio: false },
      provenance: { source: "test" },
    } as MotionPackageV2;
    const job = db.createJob({
      projectId: project.id,
      idempotencyKey: "vision-final-composition",
      modelId: "alibaba:wan3-video",
      task: "image-to-video",
      prompt: pkg.generation.prompt,
      inputAssetIds: [plate.id],
      options: {
        media: [{ assetId: plate.id, role: "start-image" }],
        internalProvenance: {
          source: "vision-motion-package-v2",
          packageFingerprint: motionPackageV2Fingerprint(pkg),
          sourceAssetId: source.id,
          generationPlateAssetId: plate.id,
          typographyOverlayAssetId: overlay.id,
        },
      },
    });
    const raw = db.addAsset({
      projectId: project.id,
      kind: "video",
      name: "raw-wan.mp4",
      mime: "video/mp4",
      path: "/tmp/raw-wan.mp4",
      width: 1080,
      height: 1440,
      duration: 3,
      hash: "raw",
      provenance: JSON.stringify({
        jobId: job.id,
        providerTaskId: "task_1",
        internalProvenance: {
          source: "vision-motion-package-v2",
          packageFingerprint: motionPackageV2Fingerprint(pkg),
          sourceAssetId: source.id,
          generationPlateAssetId: plate.id,
          typographyOverlayAssetId: overlay.id,
        },
      }),
    });
    db.updateJob(job.id, { status: "completed", providerTaskId: "task_1", outputAssetId: raw.id });
    return { db, project, source, overlay, pkg, raw, job };
  }

  it("composes only a lineage-matched raw Wan video with its trusted overlay and persists final provenance", async () => {
    const data = fixture();
    const { composeMotionPackageFinal } = await import("@/lib/vision/final-composition");
    const verifyOverlay = vi.fn(async () => undefined);
    const composite = vi.fn(async () => "/tmp/final.mp4");
    const adoptAsset = vi.fn(async () => ({ path: "/assets/final.mp4", hash: "final", width: 1080, height: 1440, duration: 3, codec: "h264", container: "mov,mp4,m4a,3gp,3g2,mj2" }));

    const result = await composeMotionPackageFinal({ package: data.pkg, rawVideoAssetId: data.raw.id }, {
      db: data.db,
      verifyOverlay,
      composite,
      adoptAsset,
      probeVideo: async () => ({ width: 1080, height: 1440, duration: 3 }),
    });

    expect(verifyOverlay).toHaveBeenCalledWith(data.source, data.overlay, data.pkg.analysis.ocr.regions);
    expect(composite).toHaveBeenCalledWith(data.raw.path, data.overlay.path);
    expect(adoptAsset).toHaveBeenCalledWith("/tmp/final.mp4", "video/mp4");
    expect(result.kind).toBe("final-video");
    expect(JSON.parse(result.provenance)).toMatchObject({
      source: "vision-final-typography-composition",
      rawVideoAssetId: data.raw.id,
      typographyOverlayAssetId: data.overlay.id,
      motionPackage: { fingerprint: motionPackageV2Fingerprint(data.pkg), sourceAssetId: data.source.id },
      media: { codec: "h264" },
    });
  });

  it("refuses a video whose probed dimensions do not match the trusted overlay before FFmpeg", async () => {
    const data = fixture();
    const { composeMotionPackageFinal } = await import("@/lib/vision/final-composition");
    const composite = vi.fn(async () => "/tmp/final.mp4");

    await expect(composeMotionPackageFinal({ package: data.pkg, rawVideoAssetId: data.raw.id }, {
      db: data.db,
      verifyOverlay: async () => undefined,
      composite,
      adoptAsset: async () => ({ path: "/assets/final.mp4", hash: "final", width: 1080, height: 1440, duration: 3, codec: "h264", container: "mp4" }),
      probeVideo: async () => ({ width: 720, height: 1280, duration: 3 }),
    })).rejects.toThrow(/dimensions must match/i);

    expect(composite).not.toHaveBeenCalled();
  });

  it("rejects forged raw-video job lineage and untrusted source-image provenance", async () => {
    const data = fixture();
    const { composeMotionPackageFinal } = await import("@/lib/vision/final-composition");
    const forgedRaw = data.db.addAsset({
      projectId: data.raw.projectId,
      kind: data.raw.kind,
      name: data.raw.name,
      mime: data.raw.mime,
      path: data.raw.path,
      width: data.raw.width,
      height: data.raw.height,
      duration: data.raw.duration,
      hash: "forged-raw",
      provenance: JSON.stringify({ ...JSON.parse(data.raw.provenance), jobId: "job_missing" }),
    });
    const dependencies = {
      db: data.db,
      verifyOverlay: async () => undefined,
      composite: async () => "/tmp/final.mp4",
      adoptAsset: async () => ({ path: "/assets/final.mp4", hash: "final", width: 1080, height: 1440, duration: 3, codec: "h264", container: "mp4" }),
      probeVideo: async () => ({ width: 1080, height: 1440, duration: 3 }),
    };

    await expect(composeMotionPackageFinal({ package: data.pkg, rawVideoAssetId: forgedRaw.id }, dependencies)).rejects.toThrow(/generation job lineage/i);

    const providerlessRaw = data.db.addAsset({
      projectId: data.raw.projectId,
      kind: data.raw.kind,
      name: data.raw.name,
      mime: data.raw.mime,
      path: data.raw.path,
      width: data.raw.width,
      height: data.raw.height,
      duration: data.raw.duration,
      hash: "providerless-raw",
      provenance: JSON.stringify({ ...JSON.parse(data.raw.provenance), providerTaskId: null }),
    });
    data.db.updateJob(data.job.id, { status: "completed", providerTaskId: null, outputAssetId: providerlessRaw.id });
    await expect(composeMotionPackageFinal({ package: data.pkg, rawVideoAssetId: providerlessRaw.id }, dependencies)).rejects.toThrow(/generation job lineage/i);

    const untrustedSource = fixture({ source: "upload" });
    await expect(composeMotionPackageFinal({ package: untrustedSource.pkg, rawVideoAssetId: untrustedSource.raw.id }, { ...dependencies, db: untrustedSource.db })).rejects.toThrow(/trusted source-image provenance/i);
  });

  it("rejects altered protected pixels and opaque pixels outside the typography safety mask", async () => {
    const { verifyTrustedTypographyOverlay } = await import("@/lib/vision/final-composition");
    const directory = await mkdtemp(path.join(os.tmpdir(), "tiny-soho-final-overlay-"));
    directories.push(directory);
    const sourcePath = path.join(directory, "source.png");
    const trustedOverlayPath = path.join(directory, "trusted.png");
    const alteredOverlayPath = path.join(directory, "altered.png");
    const opaqueOutsidePath = path.join(directory, "outside.png");
    const sourcePixels = Buffer.alloc(10 * 10 * 4, 0);
    for (let index = 0; index < sourcePixels.length; index += 4) {
      sourcePixels[index] = 30;
      sourcePixels[index + 1] = 70;
      sourcePixels[index + 2] = 120;
      sourcePixels[index + 3] = 255;
    }
    await sharp(sourcePixels, { raw: { width: 10, height: 10, channels: 4 } }).png().toFile(sourcePath);
    await sharp(sourcePixels, { raw: { width: 10, height: 10, channels: 4 } }).png().toFile(trustedOverlayPath);
    const altered = Buffer.from(sourcePixels);
    altered[0] = 255;
    await sharp(altered, { raw: { width: 10, height: 10, channels: 4 } }).png().toFile(alteredOverlayPath);
    await sharp(sourcePixels, { raw: { width: 10, height: 10, channels: 4 } }).png().toFile(opaqueOutsidePath);
    const source = { path: sourcePath, width: 10, height: 10 } as never;
    const fullCanvasRegion = [{ id: "copy", text: "copy", detectionConfidence: null, recognitionConfidence: null, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], boundingBox: { x: 0, y: 0, width: 1, height: 1 } }];

    await expect(verifyTrustedTypographyOverlay(source, { path: trustedOverlayPath } as never, fullCanvasRegion)).resolves.toBeUndefined();
    await expect(verifyTrustedTypographyOverlay(source, { path: alteredOverlayPath } as never, fullCanvasRegion)).rejects.toThrow(/original source pixels/i);
    await expect(verifyTrustedTypographyOverlay(source, { path: opaqueOutsidePath } as never, [])).rejects.toThrow(/outside the typography safety mask/i);
  });

  it("uses a tolerant frame metric for lossy H.264 typography restoration", async () => {
    const { assertTypographyFrameSimilarity } = await import("@/lib/media");
    const overlay = Buffer.from([
      20, 40, 60, 255,
      0, 0, 0, 0,
    ]);
    const visuallyEquivalentFrame = Buffer.from([
      26, 35, 67, 255,
      90, 80, 70, 255,
    ]);
    const corruptedTypographyFrame = Buffer.from([
      180, 180, 180, 255,
      90, 80, 70, 255,
    ]);

    expect(() => assertTypographyFrameSimilarity(visuallyEquivalentFrame, overlay, 1, 2)).not.toThrow();
    expect(() => assertTypographyFrameSimilarity(corruptedTypographyFrame, overlay, 1, 2)).toThrow(/visual tolerance/i);
  });
});
