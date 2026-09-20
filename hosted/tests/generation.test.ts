import { describe, expect, it } from "vitest";
import { generationFingerprint, preflightGeneration } from "@/lib/generation";

describe("hosted Wan image-to-video preflight", () => {
  it("rejects a Wan 2.7 request without exactly one start image", () => {
    expect(() => preflightGeneration({
      modelId: "wan2.7-i2v",
      prompt: "Gentle movement",
      media: [],
      options: { duration: 5, resolution: "720P" },
      freeQuotaModels: ["wan2.7-i2v"],
    })).toThrow(/start image/i);
  });

  it("rejects a model without an explicit Free Quota confirmation", () => {
    expect(() => preflightGeneration({
      modelId: "wan3-video",
      prompt: "Gentle movement",
      media: [{ assetId: "start", role: "start-image" }],
      options: { duration: 5, resolution: "720P", aspectRatio: "9:16" },
      freeQuotaModels: [],
    })).toThrow(/free quota/i);
  });

  it("normalizes the prompt and options before fingerprinting a valid request", () => {
    const request = preflightGeneration({
      modelId: "wan3-video",
      prompt: "  Gentle movement  ",
      media: [{ assetId: "start", role: "start-image" }],
      options: { resolution: "720P", duration: 5, aspectRatio: "9:16" },
      freeQuotaModels: ["wan3-video"],
    });

    expect(request.prompt).toBe("Gentle movement");
    expect(generationFingerprint(request)).toMatch(/^[a-f0-9]{64}$/);
  });
});
