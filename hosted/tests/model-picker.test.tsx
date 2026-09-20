// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "@/components/ModelPicker";

describe("ModelPicker", () => {
  it("shows a non-motion-only model and requires acknowledgement", () => {
    render(
      <ModelPicker
        selectedId="wan2.7-t2v"
        acknowledgements={[]}
        onChange={vi.fn()}
        onAcknowledge={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("option", { name: /Wan 2.7 Text to Video/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /acknowledge/i })).toBeInTheDocument();
  });
});
