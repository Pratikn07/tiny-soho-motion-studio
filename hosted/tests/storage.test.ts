import { describe, expect, it, vi } from "vitest";
import {
  signAssetDownload,
  sourceObjectPath,
  uploadSourceImage,
  validateSourceImage,
} from "@/lib/storage";

describe("hosted Studio source images", () => {
  it("rejects an executable disguised as a source image", async () => {
    await expect(
      validateSourceImage(new File(["not-an-image"], "frame.png", { type: "image/png" })),
    ).rejects.toThrow(/readable image/i);
  });

  it("reads a valid PNG's dimensions before accepting it", async () => {
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+HPwW8QAAAABJRU5ErkJggg==",
      "base64",
    );

    await expect(
      validateSourceImage(new File([onePixelPng], "frame.png", { type: "image/png" })),
    ).resolves.toMatchObject({ mimeType: "image/png", width: 1, height: 1 });
  });

  it("generates an owner-scoped path instead of accepting a browser path", () => {
    expect(sourceObjectPath("owner-a", "project-a", "asset-a", "../../Hero Frame.png")).toBe(
      "owners/owner-a/projects/project-a/sources/asset-a-Hero-Frame.png",
    );
  });

  it("uploads a validated image only to its generated private path", async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: "ignored" }, error: null });
    const client = { storage: { from: vi.fn().mockReturnValue({ upload }) } };
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+HPwW8QAAAABJRU5ErkJggg==",
      "base64",
    );

    await uploadSourceImage({
      client,
      ownerUserId: "owner-a",
      projectId: "project-a",
      assetId: "asset-a",
      file: new File([onePixelPng], "Frame.png", { type: "image/png" }),
    });

    expect(upload).toHaveBeenCalledWith(
      "owners/owner-a/projects/project-a/sources/asset-a-Frame.png",
      expect.any(Buffer),
      { contentType: "image/png", upsert: false },
    );
  });

  it("creates a short-lived download URL only for a route-approved object path", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    const client = { storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) } };

    await expect(
      signAssetDownload(client, "owners/owner-a/projects/project-a/sources/asset-a-Frame.png"),
    ).resolves.toBe("https://storage.test/signed");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "owners/owner-a/projects/project-a/sources/asset-a-Frame.png",
      300,
    );
  });
});
