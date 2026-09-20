import { describe, expect, it } from "vitest";
import { uploadBailianTemporaryAsset } from "@/lib/media-transport/bailian";
import { getModel } from "@/lib/models";
import type { Asset } from "@/lib/store";

const asset: Asset = {
  id: "asset_1",
  projectId: "project_1",
  kind: "reference",
  name: "reference.mp4",
  mime: "video/mp4",
  path: "/owner-only/reference.mp4",
  width: 1080,
  height: 1440,
  duration: 2,
  hash: "hash",
  provenance: "{}",
  createdAt: "2026-09-20T00:00:00.000Z",
};

describe("Bailian temporary upload", () => {
  it("uses the documented CLI arguments without a shell and keeps its locator out of errors", async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const result = await uploadBailianTemporaryAsset({
      asset,
      model: getModel("alibaba:wan2.7-r2v"),
      expiresAfterSeconds: 1800,
      now: () => Date.parse("2026-09-20T12:00:00.000Z"),
      execute: async (executable, args) => {
        calls.push({ executable, args });
        return { stdout: '{"url":"oss://temporary-bucket/reference.mp4"}', stderr: "" };
      },
    });

    expect(calls).toEqual([{ executable: "bl", args: ["file", "upload", "--file", "/owner-only/reference.mp4", "--model", "wan2.7-r2v-2026-06-12"] }]);
    expect(result).toEqual({ url: "oss://temporary-bucket/reference.mp4", expiresAt: "2026-09-20T12:30:00.000Z" });
  });

  it("rejects an unsafe or unparseable CLI locator", async () => {
    await expect(uploadBailianTemporaryAsset({
      asset,
      model: getModel("alibaba:wan2.7-r2v"),
      expiresAfterSeconds: 1800,
      execute: async () => ({ stdout: '{"url":"http://127.0.0.1/private"}', stderr: "" }),
    })).rejects.toThrow("Bailian temporary upload did not return an approved provider locator.");
  });
});
