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
});
