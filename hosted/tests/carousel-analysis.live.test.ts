import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { analyzeCarousel } from "@/lib/carousel-analysis";

const key = process.env.NVIDIA_API_KEY;

it.skipIf(!key)(
  "analyzes the recipe sample without trusting model-proposed placement",
  async () => {
    const image = readFileSync(
      new URL("../public/studio-samples/salmon-cakes.jpg", import.meta.url),
    );
    const analysis = await analyzeCarousel(
      `data:image/jpeg;base64,${image.toString("base64")}`,
      {
        NVIDIA_API_KEY: key,
        NVIDIA_VISION_MODEL: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      },
    );
    expect(analysis.stories.length).toBeGreaterThan(0);
    expect(`${analysis.summary} ${analysis.stories.map((story) => story.prompt).join(" ")}`).toMatch(/salmon|cake/i);
    expect(analysis.placement).toBe("manual");
    expect(analysis.region).toBeNull();
    expect(analysis.protectedRegions).toEqual([]);
  },
  70_000,
);
