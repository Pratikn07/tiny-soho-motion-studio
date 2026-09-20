import { describe, expect, it } from "vitest";
import { serializeAlibabaSubmit } from "@/lib/alibaba-contracts";

describe("Alibaba Singapore video contracts", () => {
  it("serializes ordered first and last keyframes for a keyframe model", () => {
    const request = serializeAlibabaSubmit({
      contractId: "wan2.2-kf2v-flash",
      prompt: "Move from the first frame to the last frame.",
      options: {},
      media: [
        { role: "first_frame", url: "https://storage.example/first" },
        { role: "last_frame", url: "https://storage.example/last" },
      ],
    });

    expect(request.path).toBe("/services/aigc/video-generation/video-synthesis");
    expect(request.body.model).toBe("wan2.2-kf2v-flash");
    expect((request.body.input.media as Array<{ type: string }>).map((media) => media.type))
      .toEqual(["first_frame", "last_frame"]);
  });

  it("uses the dedicated image-to-action endpoint and named image/video inputs", () => {
    const request = serializeAlibabaSubmit({
      contractId: "wan2.2-animate-move",
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
    expect(request.body.parameters).toMatchObject({ mode: "wan-pro" });
  });

  it("serializes the VACE image-reference operation with its own input shape", () => {
    const request = serializeAlibabaSubmit({
      contractId: "wan2.1-vace-plus:image-reference",
      prompt: "Combine the character and garden references.",
      options: { operation: "image_reference" },
      media: [
        { role: "reference_image", url: "https://storage.example/character" },
        { role: "reference_image", url: "https://storage.example/garden" },
      ],
    });

    expect(request.body.model).toBe("wan2.1-vace-plus");
    expect(request.body.input).toMatchObject({
      function: "image_reference",
      ref_images_url: ["https://storage.example/character", "https://storage.example/garden"],
    });
  });
});
