// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/HostedStudio", () => ({
  HostedStudio: ({ creation }: { creation?: boolean }) => <p>{creation ? "creation page" : "existing studio"}</p>,
}));
vi.mock("@/components/creation/CreationPreview", () => ({ default: () => <p>sample preview</p> }));

import { StudioEntry } from "@/components/creation/StudioEntry";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllEnvs();
});

describe("studio entry switch", () => {
  it("keeps the existing Studio as the default", () => {
    render(<StudioEntry />);
    expect(screen.getByText("existing studio")).toBeInTheDocument();
  });

  it("opens the creation page behind sign-in with ?studio=creation", async () => {
    window.history.replaceState(null, "", "/?studio=creation");
    render(<StudioEntry />);
    expect(await screen.findByText("creation page")).toBeInTheDocument();
  });

  it("only offers the sample-data preview in development", async () => {
    window.history.replaceState(null, "", "/?studio=creation&mock=1");
    vi.stubEnv("NODE_ENV", "production");
    render(<StudioEntry />);
    expect(await screen.findByText("creation page")).toBeInTheDocument();
    cleanup();
    vi.stubEnv("NODE_ENV", "development");
    render(<StudioEntry />);
    expect(await screen.findByText("sample preview")).toBeInTheDocument();
  });
});
