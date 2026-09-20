import { describe, expect, it } from "vitest";
import {
  getVideoModelContract,
  SINGAPORE_VIDEO_MODELS,
  preflightVideoGeneration,
} from "@/lib/video-catalog";

describe("Singapore video catalogue", () => {
  it("contains every general video family offered in Singapore", () => {
    expect(SINGAPORE_VIDEO_MODELS.map((model) => model.providerModel)).toEqual(expect.arrayContaining([
      "wan2.7-t2v-2026-04-25",
      "wan2.7-t2v-2026-06-12",
      "wan2.7-i2v-2026-04-25",
      "wan2.2-kf2v-flash",
      "wan2.7-r2v",
      "wan2.7-r2v-2026-06-12",
      "wan3.0-video-prime",
      "wan2.7-videoedit",
      "wan2.2-animate-move",
    ]));
  });

  it("does not prepare an unacknowledged model for provider submission", () => {
    expect(() => preflightVideoGeneration({
      modelId: "wan2.7-t2v",
      prompt: "A gentle pan across a warm living room",
      media: [],
      options: {},
      acknowledgements: [],
    })).toThrow(/acknowledge/i);
  });

  it("allows the documented prompt-free image-to-action request shape", () => {
    const model = getVideoModelContract("wan2.2-animate-move");
    expect(model).not.toBeNull();
    expect(() => preflightVideoGeneration({
      modelId: "wan2.2-animate-move",
      prompt: "",
      media: [
        { assetId: "character", role: "first_frame" },
        { assetId: "motion", role: "driving_video" },
      ],
      options: { mode: "wan-std" },
      acknowledgements: [{ modelId: "wan2.2-animate-move", contractVersion: model!.contractVersion }],
    })).not.toThrow();
  });
});
