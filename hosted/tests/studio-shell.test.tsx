// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioShell } from "@/components/StudioShell";

describe("hosted Creative Studio shell", () => {
  it("makes Director, Workflows, and Vision Lab visible alongside Motion", () => {
    render(<StudioShell api={{ listProjects: vi.fn().mockResolvedValue([]) } as never} />);

    expect(screen.getByRole("button", { name: "Creative Director" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workflows" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vision Lab" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Creative Director" }));
    expect(screen.getByRole("heading", { name: "Creative Director" })).toBeInTheDocument();
  });
});
