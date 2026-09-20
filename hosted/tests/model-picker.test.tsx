// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "@/components/ModelPicker";

describe("ModelPicker", () => {
  it("shows every Singapore video family rather than a single motion model", () => {
    render(
      <ModelPicker
        selectedId="wan2.7-t2v"
        acknowledgements={[]}
        onChange={vi.fn()}
        onAcknowledge={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", { name: "Text to video" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Image to video" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "First and last frame video" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Reference to video" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Video editing" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Image to action" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Video character swap" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Wan 2.6 Reference to Video Flash/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Wan 2.1 VACE Plus — local video edit/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Wan 2.2 Animate Mix/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acknowledge/i })).toBeInTheDocument();
  });
});
