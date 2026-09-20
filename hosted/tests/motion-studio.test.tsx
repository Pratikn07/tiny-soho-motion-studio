// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MotionStudio } from "@/components/MotionStudio";

describe("hosted Motion Studio", () => {
  it("does not enable generation before required media and billing acknowledgement", async () => {
    render(<MotionStudio api={{ listProjects: vi.fn().mockResolvedValue([]) } as never} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));

    expect(screen.getByRole("button", { name: /acknowledge model billing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
