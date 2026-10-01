// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreationShell } from "@/components/creation/CreationShell";
import { createMockCreationApi } from "@/components/creation/mock-api";
import { mockModels } from "@/components/creation/model/mock-routes";
import { mockReview } from "@/components/creation/motion/mock-routes";
import { contractFixtures } from "@/lib/contract/fixtures";

const file = (name: string) => new File([new Uint8Array(8)], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" });

async function openPotty() {
  const api = createMockCreationApi({ measure: async () => ({ width: 1122, height: 1402 }), objectUrl: () => "blob:u" });
  render(<CreationShell api={api} />);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file("potty-background.jpg"), file("potty-text.png")] } });
  const motion = await screen.findByRole("region", { name: "Motion" }, { timeout: 3000 });
  // The slide is ready (layers checked) once the review has answered, either way.
  await within(motion).findByText(/Pick one, safest first|Suggestions aren't available/, {}, { timeout: 3000 });
  const id = () => new URL(window.location.href).searchParams.get("creation")!;
  const saved = async () => {
    await screen.findByText("Saved", {}, { timeout: 3000 });
    return (await api.getCreation(id())).document.slides[0];
  };
  return { api, motion, saved };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/?studio=creation");
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
  Object.assign(mockReview, { failReview: false, failIdea: false, calls: 0 });
  Object.assign(mockModels, { acknowledged: new Set(), reservedUsd: 0, runs: [], fit: {} });
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("motion panel", () => {
  it("shows three suggestions with their risks, and choosing one writes the motion into the slide", async () => {
    const { motion, saved } = await openPotty();
    const group = await within(motion).findByRole("radiogroup", { name: "Suggested motions" }, { timeout: 3000 });
    const options = within(group).getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(group).toHaveTextContent("Curious look, calm smile");
    expect(group).toHaveTextContent("Some risk: may lean toward 'Start with the basics:'");
    expect(within(group).queryByText(/The camera remains static/)).not.toBeInTheDocument(); // Prompt hidden.
    fireEvent.click(within(group).getAllByRole("button", { name: "Show details" })[1]);
    expect(within(group).getByText(/The camera remains static/)).toBeInTheDocument();

    fireEvent.click(options[1]);
    const slide = await saved();
    const suggestion = contractFixtures.reviewCompleted.reviewRun.result!.suggestions[1];
    expect(slide.motion).toEqual({ source: "suggestion", suggestionIndex: 1, story: suggestion.story, prompt: suggestion.prompt, motionStyle: "calm" });
    expect(slide.reviewRunId).toMatch(/^[0-9a-f-]{36}$/); // The review is recorded, so a reload doesn't run it again.
    expect(within(motion).getByRole("complementary", { name: "Design advice" })).toHaveTextContent("move the girl about 4%");
  });

  it("checks her own idea and keeps her words unless she takes the suggested change", async () => {
    const { motion, saved } = await openPotty();
    const box = within(motion).getByRole("textbox", { name: "Or describe your own" });
    fireEvent.change(box, { target: { value: "she waves at the camera" } });
    fireEvent.click(within(motion).getByRole("button", { name: "Check my idea" }));
    expect(await within(motion).findByText("One change would help.")).toBeInTheDocument();
    expect(motion).toHaveTextContent("Waving with her left hand will cross 'Start with the basics:'.");
    expect(box).toHaveValue("she waves at the camera"); // Not rewritten.

    fireEvent.click(within(motion).getByRole("button", { name: "Keep mine" }));
    let slide = await saved();
    expect(slide.motion).toMatchObject({ source: "creator", story: "she waves at the camera" });
    expect(slide.motion?.prompt).toContain("she waves at the camera");

    fireEvent.click(within(motion).getByRole("button", { name: "Check my idea" }));
    fireEvent.click(await within(motion).findByRole("button", { name: "Use suggestion" }));
    slide = await saved();
    expect(box).toHaveValue("She waves at the camera with her right hand, then smiles.");
    expect(slide.motion).toMatchObject({ source: "creator", story: "She waves at the camera with her right hand, then smiles." });
    expect(slide.motion?.prompt).toContain("right hand");
  });

  it("uses a safe idea as written and says so", async () => {
    const { motion, saved } = await openPotty();
    const box = within(motion).getByRole("textbox", { name: "Or describe your own" });
    fireEvent.change(box, { target: { value: "she lifts the towel and smiles" } });
    fireEvent.blur(box); // Checking on blur, no button needed.
    expect(await within(motion).findByText(/Looks good\./)).toBeInTheDocument();
    expect((await saved()).motion).toMatchObject({ source: "creator", story: "she lifts the towel and smiles" });
  });

  it("keeps the idea box working when suggestions aren't available, and retries on request", async () => {
    mockReview.failReview = true;
    const { motion } = await openPotty();
    expect(await within(motion).findByText(/Suggestions aren't available right now/)).toBeInTheDocument();
    expect(within(motion).getByRole("textbox", { name: "Or describe your own" })).toBeEnabled();
    mockReview.failReview = false;
    fireEvent.click(within(motion).getByRole("button", { name: "Try again" }));
    expect(await within(motion).findByRole("radiogroup", { name: "Suggested motions" })).toBeInTheDocument();
  });

  it("explains Calm and Lively in words and warns when Lively would crowd the text", async () => {
    const { motion, saved } = await openPotty();
    const group = await within(motion).findByRole("radiogroup", { name: "Suggested motions" });
    fireEvent.click(within(group).getAllByRole("radio")[0]);
    const style = within(motion).getByRole("group", { name: "How much movement" });
    expect(style).toHaveTextContent("Bigger movement and expression. It may cross your text.");
    expect(style).not.toHaveTextContent(/0\.[46]/); // No numbers shown.
    fireEvent.click(within(style).getByRole("radio", { name: /Lively/ }));
    expect(style).toHaveTextContent("Lively is likely to cross them"); // Potty clearance is 1%.
    expect((await saved()).motion?.motionStyle).toBe("lively");
  });
});
