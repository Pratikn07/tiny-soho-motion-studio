// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { contractFixtures } from "@/lib/contract/fixtures";
import type { SlideV2 } from "@/lib/contract";
import { withSlideLayers } from "@/lib/creations";
import { createMockCreationApi } from "@/components/creation/mock-api";
import { TextAnimationPanel } from "@/components/creation/text-animation/TextAnimationPanel";
import { MotionPanel } from "@/components/creation/motion/MotionPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const direction = {
  runId: "3c0e5436-38fd-4dd9-a7e6-33b1124a7b43",
  previewAssetId: "5467d072-a33a-49a2-bae1-3b37bd7ca9c5",
  story: "A sleepy toddler rubs one eye slowly and blinks.",
  prompt: "A sleepy toddler rubs one eye slowly and blinks.\nAvoid: No camera moves.",
};

function setup(slideChange: Partial<SlideV2> = {}) {
  let creation = structuredClone(contractFixtures.creation);
  creation.document.slides[0] = { ...creation.document.slides[0], direction, ...slideChange };
  const api = { ...createMockCreationApi(), assetUrl: vi.fn(async () => "https://example.test/preview.mp4"),
    fetchJson: vi.fn(async () => { throw new Error("no review in this test"); }) };
  const edit = vi.fn((change) => { creation = { ...creation, document: change(creation.document) }; });
  const editSlide = vi.fn((change) => { creation.document.slides[0] = change(creation.document.slides[0]); });
  const props = () => ({ creation, slide: creation.document.slides[0], ready: true, api, edit, editSlide,
    saveServerStep: async () => {} });
  return { props, api, slide: () => creation.document.slides[0] };
}

it("shows the director's text animation instead of the line-reveal settings", async () => {
  const { props, api } = setup();
  render(<TextAnimationPanel {...props()} />);
  expect(screen.getByText(/Designed by the motion director for this slide/)).toBeInTheDocument();
  const video = await screen.findByLabelText("The director's text animation");
  expect(video).toHaveAttribute("src", "https://example.test/preview.mp4");
  expect(api.assetUrl).toHaveBeenCalledWith(direction.previewAssetId);
  expect(screen.queryByLabelText("Text style")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Cover image")).toBeInTheDocument();
});

it("puts the director's scene first and uses it as the slide's motion", () => {
  const { props, slide } = setup({ motion: undefined });
  render(<MotionPanel {...props()} />);
  const pick = screen.getByRole("radio", { name: /The director’s scene \(recommended\)/ });
  expect(pick).not.toBeChecked();
  fireEvent.click(pick);
  expect(slide().motion).toMatchObject({ source: "creator", story: direction.story, prompt: direction.prompt });
});

it("forgets the director when the slide's layers are replaced", () => {
  const creation = structuredClone(contractFixtures.creation);
  creation.document.slides[0] = { ...creation.document.slides[0], direction };
  const updated = withSlideLayers(creation.document, creation.document.slides[0].id, {
    background: { assetId: "66666666-6666-4666-8666-666666666666", width: 1080, height: 1350 },
    textAssetId: null,
    checks: creation.document.slides[0].checks!,
  });
  expect(updated.slides[0].direction).toBeUndefined();
});
