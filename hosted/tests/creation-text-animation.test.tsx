// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { DEFAULT_TEXT_ANIMATION } from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import { pottyLikeText } from "./fixtures/layers/synthetic";
import { splitTextLines, scheduleText } from "@/components/creation/text-animation/lines";
import { TextAnimationPanel } from "@/components/creation/text-animation/TextAnimationPanel";
import { createMockCreationApi } from "@/components/creation/mock-api";

afterEach(cleanup);

it("splits the same synthetic potty layer as B2/P4 and matches P4's 2.37-second schedule", async () => {
  const { data, info } = await sharp(await pottyLikeText()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { boxes, pixels } = splitTextLines(data, info.width, info.height);
  expect(boxes).toHaveLength(14);
  expect(boxes[0]).toEqual([56, 60, 576, 104]);
  expect(boxes[13]).toEqual([56, 1256, 420, 1300]);
  expect(pixels[(60 * info.width + 60) * 4 + 3]).toBe(255);
  expect(pixels[(105 * info.width + 50) * 4 + 3]).toBe(0);
  const timing = scheduleText(DEFAULT_TEXT_ANIMATION, boxes.length);
  expect(timing.textInBy).toBe(2.37);
  expect(timing.starts[13]).toBe(2.02);
  expect(scheduleText({ ...DEFAULT_TEXT_ANIMATION, step: 2 }, 60).textInBy).toBeLessThanOrEqual(4.5);
  expect(scheduleText({ ...DEFAULT_TEXT_ANIMATION, style: "none" }, 14).textInBy).toBe(0);
});

it("keeps icon and descender pixels in exactly one line while removing haze", () => {
  const pixels = new Uint8ClampedArray(100 * 30 * 4);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 100; x++) {
    pixels[(y * 100 + x) * 4 + 3] = ((y >= 2 && y < 7) || (y >= 15 && y < 20)) && x >= 10 && x < 70 ? 240
      : y >= 7 && y < 10 && x === 12 ? 255 : 5;
  }
  const result = splitTextLines(pixels, 100, 30);
  expect(result.boxes).toEqual([[10, 2, 70, 10], [10, 15, 70, 20]]);
});

it("writes defaults, a slide override and the cover choice without altering other slides", () => {
  let creation = structuredClone(contractFixtures.creation);
  delete creation.document.slides[0].textAnimation;
  const slide = creation.document.slides[0];
  const edit = vi.fn((change) => { creation = { ...creation, document: change(creation.document) }; });
  const editSlide = vi.fn((change) => { creation.document.slides[0] = change(creation.document.slides[0]); });
  const api = createMockCreationApi();
  const draw = { clearRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(draw as never);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const props = () => ({ creation, slide: creation.document.slides[0], ready: true, api, edit, editSlide, saveServerStep: async()=>{} });
  const ui = render(<TextAnimationPanel {...props()} />);
  fireEvent.change(screen.getByLabelText("Text style"), { target: { value: "fade" } });
  expect(creation.document.defaults.textAnimation.style).toBe("fade");
  fireEvent.click(screen.getByLabelText("Use different text settings for this slide"));
  ui.rerender(<TextAnimationPanel {...props()} />);
  fireEvent.change(screen.getByLabelText("Text speed"), { target: { value: "gentle" } });
  fireEvent.change(screen.getByLabelText("Cover image"), { target: { value: "first" } });
  expect(creation.document.slides[0].textAnimation).toMatchObject({ step: 0.18, fade: 0.5, coverFrame: "first" });
  expect(creation.document.defaults.textAnimation.coverFrame).toBe("last");
  expect(creation.document.slides[1].textAnimation).toEqual(contractFixtures.creation.document.slides[1].textAnimation);
  expect(slide.id).toBe(creation.document.slides[0].id);
  expect(screen.getByRole("button", { name: "Play text preview" })).toBeInTheDocument();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
