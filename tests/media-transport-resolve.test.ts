import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/models";
import { resolveProviderMedia } from "@/lib/media-transport/resolve";
import type { Asset } from "@/lib/store";

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: "asset_1",
  projectId: "project_1",
  kind: "reference",
  name: "reference.png",
  mime: "image/png",
  path: "/owner-only/reference.png",
  width: 1080,
  height: 1440,
  duration: null,
  hash: "hash",
  provenance: "{}",
  createdAt: "2026-09-20T00:00:00.000Z",
  ...overrides,
});

describe("provider media resolution", () => {
  it("resolves a validated local image as a data URL without returning its local path", async () => {
    const result = await resolveProviderMedia({
      model: getModel("alibaba:wan2.7-r2v"),
      media: [{ role: "reference-image", asset: asset() }],
      readFile: async () => Buffer.from("image-bytes"),
    });

    expect(result).toEqual({
      ok: true,
      media: [{ role: "reference-image", mime: "image/png", locator: { kind: "data-url", value: "data:image/png;base64,aW1hZ2UtYnl0ZXM=" } }],
    });
    expect(JSON.stringify(result)).not.toContain("/owner-only");
  });

  it("does not invoke temporary upload while the transport is unverified", async () => {
    const upload = async () => "https://temporary.example/reference.mp4";
    const result = await resolveProviderMedia({
      model: getModel("alibaba:wan2.7-r2v"),
      media: [{ role: "reference-video", asset: asset({ mime: "video/mp4", name: "reference.mp4", duration: 2 }) }],
      temporaryUpload: upload,
    });

    expect(result).toEqual({ ok: false, reason: "Local reference video is unavailable because free Singapore URL transport is not verified." });
  });

  it("uses only a validated explicitly supplied HTTPS URL for URL-required media", async () => {
    const result = await resolveProviderMedia({
      model: getModel("alibaba:wan2.7-r2v"),
      media: [{ role: "reference-video", asset: asset({ mime: "video/mp4", name: "reference.mp4", duration: 2 }), publicUrl: "https://media.example.test/reference.mp4" }],
    });

    expect(result).toEqual({ ok: true, media: [{ role: "reference-video", mime: "video/mp4", locator: { kind: "public-url", value: "https://media.example.test/reference.mp4" } }] });
  });

  it("rejects a local or credential-bearing supplied URL without fetching it", async () => {
    const result = await resolveProviderMedia({
      model: getModel("alibaba:wan2.7-r2v"),
      media: [{ role: "reference-video", asset: asset({ mime: "video/mp4", name: "reference.mp4", duration: 2 }), publicUrl: "https://token@127.0.0.1/private.mp4" }],
    });

    expect(result).toEqual({ ok: false, reason: "A supplied public media URL must be a safe HTTPS URL." });
  });
});
