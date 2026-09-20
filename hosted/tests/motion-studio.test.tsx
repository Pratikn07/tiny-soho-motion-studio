// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MotionStudio } from "@/components/MotionStudio";

describe("hosted Motion Studio", () => {
  it("does not enable generation before a start frame and quota confirmation", async () => {
    render(<MotionStudio api={{ listProjects: vi.fn().mockResolvedValue([]) } as never} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));

    expect(screen.getByText(/confirm free quota/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
