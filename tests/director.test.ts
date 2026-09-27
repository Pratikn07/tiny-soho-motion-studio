import { describe, expect, it } from "vitest";
import { directorAssetManifest } from "@/lib/director";

describe("Director asset manifest", () => {
  it("includes only the required project metadata and a non-sensitive provenance class", () => {
    const manifest = directorAssetManifest([{
      id: "asset_result", projectId: "project_1", kind: "video", name: "result.mp4", mime: "video/mp4", path: "/owner-only/result.mp4", width: 1080, height: 1440, duration: 5, hash: "hash", createdAt: "2026-09-20T00:00:00.000Z", provenance: JSON.stringify({ providerOutput: { url: "https://bucket.aliyuncs.com/secret-result.mp4", expiresAt: "2099-01-01T00:00:00.000Z" } }),
    }]);

    expect(manifest).toEqual([{ id: "asset_result", name: "result.mp4", kind: "video", mime: "video/mp4", width: 1080, height: 1440, duration: 5, provenanceClass: "provider-output" }]);
    expect(JSON.stringify(manifest)).not.toContain("/owner-only");
    expect(JSON.stringify(manifest)).not.toContain("aliyuncs");
  });
});
