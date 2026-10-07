// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/shell/AppShell";
import { sectionFromHash } from "@/components/shell/sections";
import { parseServerEnv } from "@/lib/env";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const carousels = vi.fn((bar) => <div><header>{bar}</header><p>Carousel page</p></div>);

describe("Studio shell", () => {
  it("opens on Carousels and hands its bar to the creation page as the top bar", () => {
    render(<AppShell carousels={carousels} />);
    expect(screen.getByText("Carousel page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Studio sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carousels" })).toHaveAttribute("aria-current", "page");
    expect(carousels).toHaveBeenCalled();
  });

  it("switches sections and keeps the section in the URL hash", () => {
    render(<AppShell carousels={carousels} />);
    fireEvent.click(screen.getByRole("button", { name: "Reels" }));
    expect(screen.getByRole("heading", { name: "Story reels, made step by step." })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Reel steps" }).children).toHaveLength(8);
    expect(window.location.hash).toBe("#reels");
    expect(screen.queryByText("Carousel page")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByRole("heading", { name: "One library for reels and carousels." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Creations" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Carousels" }));
    expect(screen.getByText("Carousel page")).toBeInTheDocument();
    expect(window.location.hash).toBe("#carousels");
  });

  it("opens the section named in the hash", () => {
    window.history.replaceState(null, "", "/#library");
    render(<AppShell carousels={carousels} />);
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(sectionFromHash("#nope")).toBe("carousels");
  });

  it("shows the Studio Mac status and the Claude login it uses", () => {
    render(<AppShell carousels={carousels} macState="asleep" />);
    const chip = screen.getByRole("button", { name: "Studio Mac · asleep" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Studio Mac" })).toHaveTextContent("Reel jobs wait in the queue");
    expect(screen.getByRole("dialog", { name: "Studio Mac" })).toHaveTextContent("switchable to an API key");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Studio Mac" })).not.toBeInTheDocument();
  });

  it("calls sign out from the bar", () => {
    const onSignOut = vi.fn();
    render(<AppShell carousels={carousels} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("is off unless its release flag is set", () => {
    expect(parseServerEnv({}).studioShellEnabled).toBe(false);
    expect(parseServerEnv({ TINY_SOHO_STUDIO_SHELL: "true" }).studioShellEnabled).toBe(true);
    expect(parseServerEnv({ TINY_SOHO_STUDIO_SHELL: "yes" }).studioShellEnabled).toBe(false);
  });
});
