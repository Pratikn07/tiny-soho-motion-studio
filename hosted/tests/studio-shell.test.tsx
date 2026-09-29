// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioShell } from "@/components/StudioShell";

// JSDOM does not implement native dialog methods; real browsers do.
beforeEach(() => {
  HTMLDialogElement.prototype.close = vi.fn();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("hosted Creative Studio shell", () => {
  it("opens a blank creation instead of selecting a sample carousel", async () => {
    render(<StudioShell api={{
      listCarouselCreations: vi.fn().mockResolvedValue([]),
      listAcknowledgements: vi.fn().mockResolvedValue([]),
    } as never} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Give your stills/ })).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Everyday little moments")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select slide 2: Little bites, big joy/ })).not.toBeInTheDocument();
  });
  it("makes Director, Workflows, and Vision Lab visible alongside Motion", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    window.history.replaceState(null, "", `/?carousel=${projectId}`);
    render(
      <StudioShell
        api={
          {
            listCarouselCreations: vi.fn().mockResolvedValue([{ id: projectId, name: "Saved recipe", updatedAt: "2026-09-29T12:00:00.000Z", slideCount: 1 }]),
            listProjects: vi.fn().mockResolvedValue([]),
            listAcknowledgements: vi.fn().mockResolvedValue([]),
            getCarousel: vi.fn().mockResolvedValue({
              id: projectId, revision: 1, document: { name: "Saved recipe", slides: [{
                id: "recipe", assetId: "11111111-1111-4111-8111-111111111111",
                name: "Recipe slide", width: 1000, height: 1250, origin: "upload",
                category: "Food", story: "A small bite.", selectedStory: "",
                region: { x: 35, y: 35, width: 55, height: 40 },
                protectedRegions: [], suggestions: [], reviewed: false,
              }] },
            }),
            assetUrl: vi.fn().mockResolvedValue("https://image.test/recipe.png"),
          } as never
        }
      />,
    );

    await waitFor(() => expect(screen.getByRole("textbox", { name: "The five-second story" })).toHaveValue("A small bite."));
    const story = screen.getByRole("textbox", {
      name: "The five-second story",
    });
    fireEvent.change(story, { target: { value: "A small shared smile." } });
    fireEvent.click(
      screen.getByRole("button", { name: "Open existing tools" }),
    );
    expect(
      screen.getByRole("button", { name: "Creative Director" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Workflows" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vision Lab" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Creative Director" }));
    expect(
      screen.getByRole("heading", { name: "Creative Director" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to Carousel Studio" }),
    );
    expect(
      screen.getByRole("textbox", { name: "The five-second story" }),
    ).toHaveValue("A small shared smile.");
  });
});
