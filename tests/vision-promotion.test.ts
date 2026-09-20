import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "@/lib/store";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

function streamChunks(bytes: Buffer) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 12));
      controller.enqueue(bytes.subarray(12));
      controller.close();
    },
  });
}

describe("vision artifact promotion", () => {
  const directories: string[] = [];
  const stores: ReturnType<typeof createStore>[] = [];
  afterEach(async () => {
    stores.splice(0).forEach((db) => db.close());
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("streams a validated temporary sidecar image into a project-scoped core asset with lineage", async () => {
    const { promoteVisionArtifact } = await import("@/lib/vision/promotion");
    const directory = await mkdtemp(path.join(os.tmpdir(), "tiny-soho-promotion-"));
    directories.push(directory);
    const db = createStore(":memory:");
    stores.push(db);
    const project = db.createProject("Promotion fixture");
    const visionArtifactId = "f02f4249-e793-41d0-b075-ef0c0a9d2ebe";

    const asset = await promoteVisionArtifact({
      projectId: project.id,
      visionArtifactId,
      expectedKind: "typography-overlay",
      name: "trusted-text.png",
      provenance: { sourceAssetId: "asset_source", plateMode: "original-with-protected-text" },
    }, {
      db,
      assetDirectory: directory,
      sidecar: {
        metadata: async () => ({ id: visionArtifactId, kind: "typography-overlay", mimeType: "image/png", sizeBytes: ONE_PIXEL_PNG.length }),
        content: async () => ({ body: streamChunks(ONE_PIXEL_PNG), contentType: "image/png" }),
      },
    });

    expect(asset.projectId).toBe(project.id);
    expect(asset.kind).toBe("typography-overlay");
    expect(asset.mime).toBe("image/png");
    expect(asset.width).toBe(1);
    expect(asset.height).toBe(1);
    await expect(readFile(asset.path)).resolves.toEqual(ONE_PIXEL_PNG);
    expect(JSON.parse(asset.provenance)).toMatchObject({
      source: "vision-safe-motion",
      sourceAssetId: "asset_source",
      vision: { artifactId: visionArtifactId, kind: "typography-overlay", mime: "image/png" },
    });
  });

  it("refuses a mismatched sidecar kind or MIME type before it can become a core asset", async () => {
    const { promoteVisionArtifact } = await import("@/lib/vision/promotion");
    const directory = await mkdtemp(path.join(os.tmpdir(), "tiny-soho-promotion-"));
    directories.push(directory);
    const db = createStore(":memory:");
    stores.push(db);
    const project = db.createProject("Promotion fixture");

    await expect(promoteVisionArtifact({
      projectId: project.id,
      visionArtifactId: "f02f4249-e793-41d0-b075-ef0c0a9d2ebe",
      expectedKind: "typography-overlay",
      name: "trusted-text.png",
      provenance: {},
    }, {
      db,
      assetDirectory: directory,
      sidecar: {
        metadata: async () => ({ id: "f02f4249-e793-41d0-b075-ef0c0a9d2ebe", kind: "rgba-layer", mimeType: "image/png", sizeBytes: ONE_PIXEL_PNG.length }),
        content: async () => ({ body: streamChunks(ONE_PIXEL_PNG), contentType: "image/png" }),
      },
    })).rejects.toThrow(/kind does not match/i);

    expect(db.listAssets(project.id)).toEqual([]);
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
