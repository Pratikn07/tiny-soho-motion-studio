import { describe, expect, it } from "vitest";

import { DIRECTOR_ALLOWED_MODEL_IDS } from "../../creative-worker/src/director";
import { SINGAPORE_VIDEO_MODELS } from "@/lib/video-catalog";

describe("Creative Director model catalogue", () => {
  it("accepts exactly the current hosted Singapore video models", () => {
    expect([...DIRECTOR_ALLOWED_MODEL_IDS].sort()).toEqual(
      SINGAPORE_VIDEO_MODELS.map((model) => model.id).sort(),
    );
  });
});
