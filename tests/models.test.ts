import { describe, expect, it } from "vitest";
import { compileCinemaPrompt, getModel, validateGeneration } from "@/lib/models";

describe("Tiny Soho model contracts", () => {
  it("keeps the source prompt under the provider limit after cinema controls", () => {
    const result = compileCinemaPrompt("A quiet product still", { motion: "slow-push-in", lighting: "soft daylight", framing: "close framing" });
    expect(result).toContain("slow push-in");
    expect(result.length).toBeLessThanOrEqual(5000);
  });

  it("accepts a Wan 2.7 first and last frame pair", () => {
    const model = getModel("alibaba:wan2.7-i2v");
    expect(() => validateGeneration(model, { task: "image-to-video", prompt: "A candle flickers", inputRoles: ["first-frame", "last-frame"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).not.toThrow();
  });

  it("accepts Wan 3 thirty-second and smart-duration requests", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "A botanical still life", inputRoles: [], options: { duration: 30, resolution: "1080P", aspectRatio: "3:4" }, freeQuotaConfirmed: true })).not.toThrow();
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "A botanical still life", inputRoles: [], options: { duration: -1, resolution: "720P", aspectRatio: "adaptive" }, freeQuotaConfirmed: true })).not.toThrow();
  });

  it("rejects a Wan 3 duration above its model-specific maximum", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "A botanical still life", inputRoles: [], options: { duration: 31, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/30/);
  });

  it("rejects unconfirmed free-quota models before they can submit", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "A botanical still life", inputRoles: [], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: false })).toThrow(/free quota/i);
  });

  it.each([
    ["image", ["reference-image"]],
    ["video", ["reference-video"]],
    ["audio", ["reference-audio"]],
    ["image and video", ["reference-image", "reference-video"]],
    ["image and audio", ["reference-image", "reference-audio"]],
    ["video and audio", ["reference-video", "reference-audio"]],
    ["image, video, and audio", ["reference-image", "reference-video", "reference-audio"]],
  ] as const)("accepts Wan 3 mixed %s references", (_name, inputRoles) => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "Create a gentle, cohesive motion study", inputRoles: [...inputRoles], options: { duration: 5, resolution: "720P", aspectRatio: "adaptive" }, freeQuotaConfirmed: true })).not.toThrow();
  });

  it("accepts Wan 3's documented 10-image, 5-video, 5-audio reference maximum", () => {
    const model = getModel("alibaba:wan3-video");
    const inputRoles = [
      ...Array<"reference-image">(10).fill("reference-image"),
      ...Array<"reference-video">(5).fill("reference-video"),
      ...Array<"reference-audio">(5).fill("reference-audio"),
    ];
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "Create a gentle, cohesive motion study", inputRoles, options: { duration: 5, resolution: "720P", aspectRatio: "adaptive" }, freeQuotaConfirmed: true })).not.toThrow();
  });

  it("rejects Wan 3 reference inputs above their documented limits", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "Create a gentle, cohesive motion study", inputRoles: Array<"reference-image">(11).fill("reference-image"), options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/at most 10 reference image/i);
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "Create a gentle, cohesive motion study", inputRoles: Array<"reference-video">(6).fill("reference-video"), options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/at most 5 reference video/i);
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "Create a gentle, cohesive motion study", inputRoles: Array<"reference-audio">(6).fill("reference-audio"), options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/at most 5 reference audio/i);
  });

  it("rejects a Wan 3 frame and reference input in the same request", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "Create a gentle, cohesive motion study", inputRoles: ["start-image", "reference-image"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/cannot mix frame and reference/i);
  });
});
