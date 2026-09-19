import { describe, expect, it } from "vitest";
import { compileCinemaPrompt, getModel, validateGeneration } from "@/lib/models";

describe("Tiny Soho model contracts", () => {
  it("keeps the source prompt under the provider limit after cinema controls", () => {
    const result = compileCinemaPrompt("A quiet product still", { motion: "slow-push-in", lighting: "soft daylight", framing: "close framing" });
    expect(result).toContain("slow push-in");
    expect(result.length).toBeLessThanOrEqual(5000);
  });

  it("rejects a last frame for a model that only supports a first frame", () => {
    const model = getModel("alibaba:wan2.7-i2v");
    expect(() => validateGeneration(model, { task: "image-to-video", prompt: "A candle flickers", inputRoles: ["first-frame", "last-frame"], options: { duration: 5, resolution: "720P" } })).toThrow(/last frame/i);
  });

  it("rejects unconfirmed free-quota models before they can submit", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "A botanical still life", inputRoles: [], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: false })).toThrow(/free quota/i);
  });
});
