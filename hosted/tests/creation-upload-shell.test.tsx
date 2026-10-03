// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreationApi } from "@/components/creation/api";
import { createMockCreationApi } from "@/components/creation/mock-api";
import { CreationShell } from "@/components/creation/CreationShell";
import { SLIDE_PANELS } from "@/components/creation/panels";

const sizes = new WeakMap<Blob, { width: number; height: number }>();
function image(name: string, width = 1122, height = 1402) {
  const file = new File([new Uint8Array(16)], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" });
  sizes.set(file, { width, height });
  return file;
}
const carousel = () => Array.from({ length: 10 }, (_, index) => {
  const n = String(index + 1).padStart(2, "0");
  // Slide 04's text layer is exported at the wrong size; B2 must block it.
  return [image(`slide ${n}-background.jpg`), index === 3 ? image(`slide ${n}-text.png`, 1080, 1350) : image(`slide ${n}-text.png`)];
}).flat();

const mockApi = (options: Parameters<typeof createMockCreationApi>[0] = {}) => createMockCreationApi({
  measure: async (file) => sizes.get(file) ?? { width: 1122, height: 1402 },
  objectUrl: () => "blob:uploaded",
  ...options,
});

function drop(files: File[]) {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  fireEvent.change(inputs[0], { target: { files } });
}
const cards = () => within(screen.getByRole("list", { name: "Slides in carousel order" }))
  .getAllByRole("button", { name: /^Slide \d+:/ }).map((button) => button.getAttribute("aria-label"));
const settled = (count: number) => waitFor(() => {
  const labels = cards();
  expect(labels).toHaveLength(count);
  for (const label of labels) expect(label).toMatch(/Ready|Needs a fix|Upload stopped/);
}, { timeout: 5000 });

beforeEach(() => {
  window.history.replaceState(null, "", "/?studio=creation");
  URL.createObjectURL = vi.fn(() => "blob:local");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("creation page and layered upload", () => {
  it("offers the old studio in Tools without needing a saved creation", async () => {
    render(<CreationShell api={mockApi()} />);
    await screen.findByText("Drop the whole carousel here");
    const tools = screen.getByText("Tools", { selector: "summary" });
    fireEvent.click(tools);
    expect(screen.getByRole("link", { name: "Old studio" })).toHaveAttribute("href", "/?studio=legacy");
  });
  it("takes 20 files in one drop, pairs them, checks each slide, and keeps order and names after a reload", async () => {
    const api = mockApi();
    const save = vi.spyOn(api, "saveCreation");
    const first = render(<CreationShell api={api} />);
    expect(await screen.findByText("Drop the whole carousel here")).toBeInTheDocument();
    drop(carousel().reverse());
    await settled(10);
    expect(cards()).toEqual(Array.from({ length: 10 }, (_, index) => {
      const n = String(index + 1).padStart(2, "0");
      return `Slide ${index + 1}: slide ${n}, ${index === 3 ? "Needs a fix" : "Ready"}`;
    }));
    expect(new URL(window.location.href).searchParams.get("creation")).toMatch(/^[0-9a-f-]{36}$/);

    fireEvent.click(screen.getByRole("button", { name: /^Slide 4:/ }));
    expect(screen.getByRole("region", { name: "Problems to fix" })).toHaveTextContent(
      "The text layer is 1080×1350 but the background is 1122×1402. Export both at the same size.");

    // Keyboard reorder: slide 03 moves before slide 02, then the creation is renamed.
    const third = screen.getByRole("button", { name: /^Slide 3:/ });
    third.focus();
    fireEvent.keyDown(third, { key: "ArrowUp", altKey: true });
    const title = screen.getByRole("textbox", { name: "Creation name" });
    fireEvent.change(title, { target: { value: "Potty week" } });
    fireEvent.blur(title);
    await screen.findByText("Saved", {}, { timeout: 3000 });
    expect(save).toHaveBeenCalled();

    first.unmount();
    render(<CreationShell api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(10));
    expect(screen.getByRole("textbox", { name: "Creation name" })).toHaveValue("Potty week");
    expect(cards().slice(0, 4)).toEqual([
      "Slide 1: slide 01, Ready", "Slide 2: slide 03, Ready", "Slide 3: slide 02, Ready", "Slide 4: slide 04, Needs a fix",
    ]);
    expect(screen.getByRole("button", { name: "Potty week" })).toBeInTheDocument(); // In the creations list.
  });

  it("keeps files without a partner in a tray until the creator matches them", async () => {
    render(<CreationShell api={mockApi()} />);
    drop([image("lonely-background.jpg"), image("cover.png")]);
    const tray = await screen.findByRole("region", { name: "2 files need a partner" });
    expect(within(tray).getByText("No text layer has the same name.")).toBeInTheDocument();
    const row = within(tray).getByText("lonely-background.jpg").closest("li")!;
    fireEvent.change(within(row).getByRole("combobox", { name: "Partner for lonely-background.jpg" }), { target: { value: "__alone__" } });
    fireEvent.click(within(row).getByRole("button", { name: "Add slide" }));
    await settled(1);
    expect(cards()).toEqual(["Slide 1: lonely, Ready"]);
    expect(screen.getByRole("region", { name: "1 file needs a partner" })).toHaveTextContent("cover.png");
    expect(screen.getByText("None", { selector: "dd" })).toBeInTheDocument(); // No text layer.
  });

  it("shows a failed upload on its slide and retries just that slide", async () => {
    let fail = true;
    render(<CreationShell api={mockApi({ failUploadsFor: () => fail })} />);
    drop([image("potty-background.jpg"), image("potty-text.png")]);
    await waitFor(() => expect(cards()).toEqual(["Slide 1: potty, Upload stopped"]), { timeout: 3000 });
    expect(screen.getByText("The connection dropped while uploading. Try again.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(screen.getByRole("list", { name: "Slides in carousel order" })).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(cards()).toEqual(["Slide 1: potty, Ready"]), { timeout: 3000 });
    // The potty fixture's warnings explain the automatic fixes.
    expect(screen.getByRole("region", { name: "Will be corrected during rendering" })).toHaveTextContent("they will be made solid");
  });

  it("reloads and reapplies the creator's edit when another tab saved first", async () => {
    const api = mockApi();
    render(<CreationShell api={api} />);
    drop([image("potty-background.jpg"), image("potty-text.png")]);
    await settled(1);
    const id = new URL(window.location.href).searchParams.get("creation")!;
    const other = await api.getCreation(id);
    await api.saveCreation(id, other.revision, { ...other.document, defaults: { ...other.document.defaults, motionStyle: "lively" } });
    const title = screen.getByRole("textbox", { name: "Creation name" });
    fireEvent.change(title, { target: { value: "Renamed here" } });
    fireEvent.blur(title);
    await screen.findByText("Saved", {}, { timeout: 3000 });
    const saved = await api.getCreation(id);
    expect(saved.document.name).toBe("Renamed here");
    expect(saved.document.defaults.motionStyle).toBe("lively");
  });

  it("gives registered panels the selected slide and whether it is ready", async () => {
    const seen: Array<{ name: string; ready: boolean }> = [];
    SLIDE_PANELS.push({ id: "test", title: "Test panel", Component: ({ slide, ready }) => {
      seen.push({ name: slide.name, ready });
      return <p>Panel for {slide.name}</p>;
    } });
    try {
      render(<CreationShell api={mockApi()} />);
      drop([image("potty-background.jpg"), image("potty-text.png")]);
      await settled(1);
      expect(screen.getByRole("region", { name: "Test panel" })).toHaveTextContent("Panel for potty");
      expect(seen.at(-1)).toEqual({ name: "potty", ready: true });
    } finally {
      SLIDE_PANELS.pop();
    }
  });

  it("opens a saved creation from the address, and says so when it can't", async () => {
    const api: CreationApi = mockApi({ seed: true });
    window.history.replaceState(null, "", "/?studio=creation&creation=3f1c2a4e-8b7d-4c1a-9e2f-5a6b7c8d9e01");
    render(<CreationShell api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(screen.getByRole("textbox", { name: "Creation name" })).toHaveValue("Potty words, meal prep");
    cleanup();
    window.history.replaceState(null, "", "/?studio=creation&creation=00000000-0000-4000-8000-000000000000");
    await act(async () => { render(<CreationShell api={api} />); });
    expect(await screen.findByRole("alert")).toHaveTextContent("That creation couldn't be opened.");
    expect(new URL(window.location.href).searchParams.has("creation")).toBe(false);
  });
});
