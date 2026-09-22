// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { jobStatusDetail, MotionStudio } from "@/components/MotionStudio";

describe("hosted Motion Studio", () => {
  it("explains each non-terminal generation stage in plain language", () => {
    expect(jobStatusDetail("queued")).toBe("Waiting for the Creative Worker to pick up your request.");
    expect(jobStatusDetail("submitting")).toBe("Preparing your request for Alibaba Model Studio.");
    expect(jobStatusDetail("submitted")).toBe("Submitted to Alibaba; waiting for rendering to begin.");
    expect(jobStatusDetail("running")).toBe("Alibaba is rendering your video.");
    expect(jobStatusDetail("downloading")).toBe("Saving the completed video to your project.");
  });

  it("does not enable generation before required media and billing acknowledgement", async () => {
    render(<MotionStudio api={{ listProjects: vi.fn().mockResolvedValue([]) } as never} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));

    expect(screen.getByRole("button", { name: /acknowledge model billing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });
});
