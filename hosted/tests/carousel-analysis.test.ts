import { it, expect, vi } from "vitest";
import { analyzeCarousel, parseAnalysis } from "@/lib/carousel-analysis";
it("validates suggestions and rejects arbitrary model output", () => {
  expect(() => parseAnalysis("not json")).toThrow();
  expect(() =>
    parseAnalysis(
      JSON.stringify({
        stories: [],
        protectedRegions: [],
        region: { x: 200, y: 0, width: 20, height: 20 },
      }),
    ),
  ).toThrow();
  expect(
    parseAnalysis(
      JSON.stringify({
        summary: "A child at a table",
        stories: [
          { title: "A bite", prompt: "She picks up a bite and smiles." },
        ],
        protectedRegions: [],
        region: { x: 20, y: 40, width: 70, height: 50 },
      }),
    ).stories,
  ).toHaveLength(1);
});
it("does not invoke a provider when configuration is missing", async () => {
  const fetcher = vi.fn();
  await expect(
    analyzeCarousel("data:image/png;base64,AA==", {}, fetcher),
  ).rejects.toThrow(/not configured/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("sends an image and treats the output as suggestions, with sanitized errors", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("secret provider text", { status: 401 }));
  await expect(
    analyzeCarousel(
      "data:image/png;base64,AA==",
      { NVIDIA_API_KEY: "private-key", NVIDIA_VISION_MODEL: "vision-model" },
      fetcher,
    ),
  ).rejects.toThrow(/unavailable/);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.messages[1].content[1].image_url.url).toBe(
    "data:image/png;base64,AA==",
  );
});
