import { describe, expect, it } from "vitest";

describe("public asset serialization", () => {
  it("never exposes a core asset filesystem path to browser-facing routes", async () => {
    const { toPublicAsset } = await import("@/lib/assets");
    const result = toPublicAsset({
      id: "asset_test",
      projectId: "project_test",
      kind: "generation-plate",
      name: "plate.png",
      mime: "image/png",
      path: "/private/owner-only/assets/secret.png",
      width: 100,
      height: 80,
      duration: null,
      hash: "hash",
      provenance: "{}",
      createdAt: "2026-09-20T00:00:00.000Z",
    });

    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("provenance");
    expect(result).toMatchObject({ id: "asset_test", kind: "generation-plate" });
  });
});
