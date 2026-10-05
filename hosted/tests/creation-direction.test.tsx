// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockCreationApi } from "@/components/creation/mock-api";
import { CreationShell } from "@/components/creation/CreationShell";
import { mockDirection } from "@/components/creation/direction/mock-routes";

const finished = (name: string) => new File([new Uint8Array(32)], name, { type: "image/png" });
const mockApi = () => createMockCreationApi({
  measure: async () => ({ width: 1122, height: 1402 }),
  objectUrl: () => "blob:uploaded",
});
const choose = (files: File[]) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
};
const cards = () => within(screen.getByRole("list", { name: "Slides in carousel order" }))
  .getAllByRole("button", { name: /^Slide \d+:/ }).map((button) => button.getAttribute("aria-label"));

beforeEach(() => {
  window.history.replaceState(null, "", "/?studio=creation");
  window.localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
  Object.assign(mockDirection, { pollsToFinish: 2, failStart: false, failSlides: new Set<string>(), starts: 0 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("finished slides through the motion director", () => {
  it("opens on finished slides, uploads them, directs them, and shows the slides with their new layers", async () => {
    const api = mockApi();
    render(<CreationShell api={api} initialUploadMode="finished" directionPollMs={40} />);
    expect(await screen.findByText("Drop, choose or paste the carousel")).toBeInTheDocument();

    choose([finished("in-the-car.png"), finished("daycare-dropoff.png")]);

    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(cards()[0]).toMatch(/^Slide 1: in-the-car,/);
    // The director is running: status line with elapsed time and a link to watch it.
    const watch = await screen.findByRole("link", { name: "Watch the director" });
    expect(watch).toHaveAttribute("href", "https://claude.ai/code/cse_mock");
    expect(screen.getByRole("region", { name: "Motion director" })).toHaveTextContent("Directing 2 slides");
    expect(mockDirection.starts).toBe(1);

    // Polling finishes the run; the creation reloads with layers on both slides.
    await waitFor(() => expect(screen.getByRole("region", { name: "Motion director" }))
      .toHaveTextContent("Directed 2 of 2 slides. Their layers are ready."), { timeout: 6000 });
    await waitFor(() => {
      for (const label of cards()) expect(label).toMatch(/Ready/);
    });
    const saved = await api.getCreation(new URL(window.location.href).searchParams.get("creation")!);
    expect(saved.document.slides.every((slide) => slide.layers.backgroundAssetId && slide.width === 1122)).toBe(true);
  }, 15000);

  it("offers layers instead, and explains when the director isn't set up", async () => {
    mockDirection.failStart = true;
    render(<CreationShell api={mockApi()} initialUploadMode="finished" directionPollMs={40} />);
    await screen.findByText("Drop, choose or paste the carousel");
    choose([finished("slide.png")]);
    expect(await screen.findByText("The motion director isn't set up yet. You can upload layers instead.")).toBeInTheDocument();
    cleanup();

    render(<CreationShell api={mockApi()} initialUploadMode="finished" directionPollMs={40} />);
    fireEvent.click(await screen.findByRole("button", { name: "Upload layers instead" }));
    expect(await screen.findByText("Drop the whole carousel here")).toBeInTheDocument();
  });

  it("reports a slide the director couldn't return and lets the creator try it again", async () => {
    const api = mockApi();
    render(<CreationShell api={api} initialUploadMode="finished" directionPollMs={40} />);
    await screen.findByText("Drop, choose or paste the carousel");
    choose([finished("one.png"), finished("two.png")]);
    await waitFor(() => expect(cards()).toHaveLength(2));
    const project = await api.getCreation(new URL(window.location.href).searchParams.get("creation")!);
    const second = project.document.slides.find((slide) => slide.name === "two")!.id;
    mockDirection.failSlides.add(second);
    await waitFor(() => expect(screen.getByRole("region", { name: "Motion director" }))
      .toHaveTextContent("Directed 1 of 2 slides."), { timeout: 6000 });
    expect(screen.getByText("two: The director didn't return this slide.")).toBeInTheDocument();

    mockDirection.failSlides.clear();
    fireEvent.click(screen.getByRole("button", { name: "Try the rest again" }));
    await waitFor(() => expect(mockDirection.starts).toBe(2));
  }, 15000);
});
