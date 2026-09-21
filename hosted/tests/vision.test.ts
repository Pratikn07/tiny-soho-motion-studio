import { describe, expect, it } from "vitest";

import { validateVisionJobRequest } from "@/lib/vision";

const projectId = "11111111-1111-4111-8111-111111111111";
const sourceAssetId = "22222222-2222-4222-8222-222222222222";
const otherProjectAssetId = "33333333-3333-4333-8333-333333333333";

describe("hosted Vision queue", () => {
  it("rejects a Vision job whose source asset belongs to another project", () => {
    expect(() => validateVisionJobRequest({
      projectId,
      sourceAssetId: otherProjectAssetId,
      operation: "overlay",
      options: { regions: [] },
      inputAssetIds: [],
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }, {
      sourceAsset: { id: otherProjectAssetId, projectId: "55555555-5555-4555-8555-555555555555", kind: "source-image" },
      inputAssets: [],
    })).toThrow(/source asset.*project/i);
  });

  it("keeps OCR unavailable until its optional runtime is explicitly configured", () => {
    expect(() => validateVisionJobRequest({
      projectId,
      sourceAssetId,
      operation: "ocr",
      options: {},
      inputAssetIds: [],
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }, {
      sourceAsset: { id: sourceAssetId, projectId, kind: "source-image" },
      inputAssets: [],
      capabilities: [{ capabilityId: "ocr", status: "unavailable" }],
    })).toThrow(/unavailable/i);
  });
});
