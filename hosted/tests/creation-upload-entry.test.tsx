// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/HostedStudio", () => ({
  HostedStudio: ({ creation }: { creation?: boolean }) => <p>{creation ? "creation page" : "existing studio"}</p>,
}));
vi.mock("@/components/creation/CreationPreview", () => ({ default: () => <p>sample preview</p> }));

import Home from "@/app/page";

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

  it("opens creation at the home URL when the server flag is enabled", async () => {
    vi.stubEnv("TINY_SOHO_CREATIONS_V2", "true");
    render(<Home />);
    expect(await screen.findByText("creation page")).toBeInTheDocument();
  });

  it("keeps the existing home when the flag is unset, false or malformed", () => {
    for (const value of [undefined, "false", "yes"]) {
      vi.stubEnv("TINY_SOHO_CREATIONS_V2", value);
      render(<Home />);
      expect(screen.getByText("existing studio")).toBeInTheDocument();
      cleanup();
    }
  });

  it("lets the owner return to the old studio with the flag enabled", async () => {
    vi.stubEnv("TINY_SOHO_CREATIONS_V2", "true");
    window.history.replaceState(null, "", "/?studio=legacy");
    render(<Home />);
    expect(await screen.findByText("existing studio")).toBeInTheDocument();
  });

  it("does not let mock=1 bypass sign-in for the flag's default creation page", async () => {
    vi.stubEnv("TINY_SOHO_CREATIONS_V2", "true");
    vi.stubEnv("NODE_ENV", "development");
    window.history.replaceState(null, "", "/?mock=1");
    render(<Home />);
    expect(await screen.findByText("creation page")).toBeInTheDocument();
    expect(screen.queryByText("sample preview")).toBeNull();
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
