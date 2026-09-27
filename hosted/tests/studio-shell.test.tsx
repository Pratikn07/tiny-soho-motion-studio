// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioShell } from "@/components/StudioShell";

// JSDOM does not implement native dialog methods; real browsers do.
beforeEach(() => {
  HTMLDialogElement.prototype.close = vi.fn();
});
afterEach(cleanup);

describe("hosted Creative Studio shell", () => {
  it("makes Director, Workflows, and Vision Lab visible alongside Motion", () => {
    render(<StudioShell api={{ listProjects: vi.fn().mockResolvedValue([]) } as never} />);

    const story = screen.getByRole("textbox", { name: "The five-second story" });
    fireEvent.change(story, { target: { value: "A small shared smile." } });
    fireEvent.click(screen.getByRole("button", { name: "Open existing tools" }));
    expect(screen.getByRole("button", { name: "Creative Director" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workflows" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vision Lab" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Creative Director" }));
    expect(screen.getByRole("heading", { name: "Creative Director" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Carousel Studio" }));
    expect(screen.getByRole("textbox", { name: "The five-second story" })).toHaveValue("A small shared smile.");
  });
});
