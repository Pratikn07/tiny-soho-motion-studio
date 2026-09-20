import { describe, expect, it } from "vitest";
import { providerRequest } from "../src/provider.js";

describe("Creative Worker provider request", () => {
  it("routes character animation to Alibaba's image2video endpoint", () => {
    const request = providerRequest({
      modelId: "wan2.2-animate-mix",
      task: "animate-mix",
      prompt: "",
      options: { mode: "wan-pro" },
      media: [
        { role: "first_frame", url: "https://storage.example/character" },
        { role: "driving_video", url: "https://storage.example/motion" },
      ],
    });

    expect(request.path).toBe("/services/aigc/image2video/video-synthesis");
    expect(request.body.input).toMatchObject({
      image_url: "https://storage.example/character",
      video_url: "https://storage.example/motion",
    });
  });

  it("strips a hosted Wan 3 capability suffix before calling Alibaba", () => {
    const request = providerRequest({
      modelId: "wan3.0-video-prime:reference-to-video",
      task: "reference-to-video",
      prompt: "Use the reference.",
      options: { resolution: "720P", duration: 5 },
      media: [{ role: "reference_image", url: "https://storage.example/reference" }],
    });

    expect(request.body.model).toBe("wan3.0-video-prime");
    expect(request.body.input.media).toEqual([{ type: "reference_image", url: "https://storage.example/reference" }]);
  });

  it("uses legacy image input fields for Wan 2.6 and its optional audio", () => {
    const request = providerRequest({
      modelId: "wan2.6-i2v",
      task: "image-to-video",
      prompt: "Animate the image.",
      options: { resolution: "720P", duration: 5, shotType: "multi" },
      media: [
        { role: "first_frame", url: "https://storage.example/first" },
        { role: "driving_audio", url: "https://storage.example/audio.mp3" },
      ],
    });

    expect(request.body.input).toMatchObject({
      img_url: "https://storage.example/first",
      audio_url: "https://storage.example/audio.mp3",
    });
    expect(request.body.parameters).toMatchObject({ resolution: "720P", duration: 5, shot_type: "multi" });
  });

  it("uses legacy size and audio_url fields for Wan 2.5 text-to-video", () => {
    const request = providerRequest({
      modelId: "wan2.5-t2v-preview",
      task: "text-to-video",
      prompt: "A gentle pan.",
      options: { resolution: "480P", aspectRatio: "9:16", duration: 10 },
      media: [{ role: "driving_audio", url: "https://storage.example/audio.mp3" }],
    });

    expect(request.body.input).toMatchObject({ audio_url: "https://storage.example/audio.mp3" });
    expect(request.body.parameters).toMatchObject({ size: "480*832", duration: 10 });
    expect(request.body.parameters).not.toHaveProperty("resolution");
  });

  it("uses named first and last frame fields for legacy keyframe models", () => {
    const request = providerRequest({
      modelId: "wan2.2-kf2v-flash",
      task: "keyframe-to-video",
      prompt: "Transition between frames.",
      options: { resolution: "1080P" },
      media: [
        { role: "first_frame", url: "https://storage.example/first" },
        { role: "last_frame", url: "https://storage.example/last" },
      ],
    });

    expect(request.body.input).toMatchObject({
      first_frame_url: "https://storage.example/first",
      last_frame_url: "https://storage.example/last",
    });
  });

  it("keeps VACE local-edit controls in their documented input and parameter fields", () => {
    const request = providerRequest({
      modelId: "wan2.1-vace-plus:video-edit",
      task: "video-edit",
      prompt: "Replace the jacket.",
      options: { operation: "video_edit", maskFrameId: 1, maskType: "tracking", expandRatio: 0.05 },
      media: [
        { role: "source_video", url: "https://storage.example/source.mp4" },
        { role: "mask_image", url: "https://storage.example/mask.png" },
      ],
    });

    expect(request.body.input).toMatchObject({ function: "video_edit", mask_frame_id: 1 });
    expect(request.body.parameters).toMatchObject({ mask_type: "tracking", expand_ratio: 0.05 });
  });

  it("attaches a Wan 2.7 reference voice to the first reference asset", () => {
    const request = providerRequest({
      modelId: "wan2.7-r2v",
      task: "reference-to-video",
      prompt: "The character speaks.",
      options: { duration: 5, resolution: "720P" },
      media: [
        { role: "reference_image", url: "https://storage.example/character" },
        { role: "driving_audio", url: "https://storage.example/voice.mp3" },
      ],
    });

    expect(request.body.input.media).toEqual([{
      type: "reference_image",
      url: "https://storage.example/character",
      reference_voice: "https://storage.example/voice.mp3",
    }]);
  });

  it("uses legacy reference_urls and pixel size for Wan 2.6 reference-to-video", () => {
    const request = providerRequest({
      modelId: "wan2.6-r2v-flash",
      task: "reference-to-video",
      prompt: "The two characters talk.",
      options: { resolution: "720P", aspectRatio: "9:16", duration: 10, shotType: "multi", audio: false },
      media: [
        { role: "reference_video", url: "https://storage.example/character.mp4" },
        { role: "reference_image", url: "https://storage.example/prop.png" },
      ],
    });

    expect(request.body.input).toMatchObject({
      reference_urls: ["https://storage.example/character.mp4", "https://storage.example/prop.png"],
    });
    expect(request.body.parameters).toMatchObject({ size: "720*1280", duration: 10, shot_type: "multi", audio: false });
    expect(request.body.parameters).not.toHaveProperty("resolution");
  });
});
