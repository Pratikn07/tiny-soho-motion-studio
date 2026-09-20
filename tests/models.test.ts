import { describe, expect, it } from "vitest";
import { compileCinemaPrompt, getModel, referenceIndexMap, validateGeneration } from "@/lib/models";

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

  it("accepts Wan 2.7 R2V first-frame control with five mixed image and video references", () => {
    const model = getModel("alibaba:wan2.7-r2v");
    expect(() => validateGeneration(model, {
      task: "reference-to-video",
      prompt: "Video 1 enters beside Image 1 while the first frame controls composition.",
      inputRoles: ["start-image", "reference-image", "reference-video", "reference-image", "reference-video", "reference-image"],
      options: { duration: 10, resolution: "720P", aspectRatio: "9:16" },
      freeQuotaConfirmed: true,
    })).not.toThrow();
  });

  it("rejects a sixth Wan 2.7 R2V reference and standalone reference audio", () => {
    const model = getModel("alibaba:wan2.7-r2v");
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "A scene", inputRoles: Array<"reference-image">(6).fill("reference-image"), options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/at most 5 reference/i);
    expect(() => validateGeneration(model, { task: "reference-to-video", prompt: "A scene", inputRoles: ["reference-audio"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/does not accept|reference audio/i);
  });

  it("uses Wan 3's 20,000-character prompt ceiling instead of the Wan 2.7 ceiling", () => {
    const model = getModel("alibaba:wan3-video");
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "a".repeat(20_000), inputRoles: [], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).not.toThrow();
    expect(() => validateGeneration(model, { task: "text-to-video", prompt: "a".repeat(20_001), inputRoles: [], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).toThrow(/20,000/i);
  });

  it("accepts Wan 2.7 I2V advanced URL-only roles without weakening the image-only path", () => {
    const model = getModel("alibaba:wan2.7-i2v");
    expect(() => validateGeneration(model, { task: "image-to-video", prompt: "The speaker follows the supplied track.", inputRoles: ["start-image", "driving-audio"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).not.toThrow();
    expect(() => validateGeneration(model, { task: "image-to-video", prompt: "The ending frame is preserved while the speaker follows the supplied track.", inputRoles: ["start-image", "end-image", "driving-audio"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).not.toThrow();
    expect(() => validateGeneration(model, { task: "image-to-video", prompt: "Continue the supplied clip.", inputRoles: ["first-clip"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).not.toThrow();
    expect(() => validateGeneration(model, { task: "image-to-video", prompt: "Continue into the supplied last frame.", inputRoles: ["first-clip", "end-image"], options: { duration: 5, resolution: "720P" }, freeQuotaConfirmed: true })).not.toThrow();
  });

  it("keeps Tiny Soho's safe product defaults explicit instead of relying on provider defaults", () => {
    expect(getModel("alibaba:wan2.7-i2v").defaultOptions).toMatchObject({ resolution: "720P" });
    expect(getModel("alibaba:wan2.7-r2v").defaultOptions).toMatchObject({ resolution: "720P" });
    expect(getModel("alibaba:wan3-video").defaultOptions).toMatchObject({ resolution: "720P", audio: false });
    expect(getModel("alibaba:wan3-video-prime").defaultOptions).toMatchObject({ resolution: "720P", audio: false });
  });

  it("creates deterministic per-type reference indexes for Director and prompt compilation", () => {
    expect(referenceIndexMap([
      { assetId: "video-1", role: "reference-video" },
      { assetId: "image-1", role: "reference-image" },
      { assetId: "audio-1", role: "reference-audio" },
      { assetId: "image-2", role: "reference-image" },
      { assetId: "video-2", role: "reference-video" },
    ])).toEqual({
      images: [{ index: 1, assetId: "image-1" }, { index: 2, assetId: "image-2" }],
      videos: [{ index: 1, assetId: "video-1" }, { index: 2, assetId: "video-2" }],
      audio: [{ index: 1, assetId: "audio-1" }],
    });
  });
});
