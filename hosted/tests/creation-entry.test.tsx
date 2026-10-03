// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CarouselStudio from "@/components/carousel/CarouselStudio";

const projectId = "22222222-2222-4222-8222-222222222222";
function api() {
  return {
    listCarouselCreations: vi.fn().mockResolvedValue([{
      id: projectId, name: "Salmon cakes", updatedAt: "2026-09-29T12:00:00.000Z", slideCount: 1,
    }]),
    listAcknowledgements: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
  };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("creation-first entry", () => {
  it("starts empty, lists saved creations, and never writes before a choice", async () => {
    const studioApi = api();
    render(<CarouselStudio api={studioApi as never} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Salmon cakes" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New creation" })).toBeInTheDocument();
    expect(screen.getByText("Paste or upload your images")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select slide/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save project" })).not.toBeInTheDocument();
    expect(studioApi.createProject).not.toHaveBeenCalled();
  });

  it("opens a saved creation from history and returns to an untouched new start", async () => {
    const studioApi = {
      ...api(),
      getCarousel: vi.fn().mockResolvedValue({
        id: projectId,
        revision: 1,
        document: {
          name: "Salmon cakes",
          slides: [{
            id: "11111111-1111-4111-8111-111111111111",
            assetId: "11111111-1111-4111-8111-111111111111",
            name: "Recipe slide",
            width: 1129,
            height: 1393,
            origin: "upload",
            category: "Food",
            story: "A little steam rises from the cakes.",
            selectedStory: "",
            region: { x: 35, y: 35, width: 55, height: 40 },
            protectedRegions: [],
            suggestions: [],
            reviewed: false,
          }],
        },
      }),
      assetUrl: vi.fn().mockResolvedValue("https://image.test/salmon.png"),
    };
    render(<CarouselStudio api={studioApi as never} />);
    fireEvent.click(await screen.findByRole("button", { name: "Salmon cakes" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "The five-second story" })).toHaveValue("A little steam rises from the cakes."));
    expect(screen.getByRole("textbox", { name: "Creation name" })).toHaveValue("Salmon cakes");
    fireEvent.click(screen.getByRole("button", { name: "New creation" }));
    await waitFor(() => expect(screen.getByText("Paste or upload your images")).toBeInTheDocument());
    expect(studioApi.createProject).not.toHaveBeenCalled();
  });

  it("keeps examples opt-in rather than populating the blank start", async () => {
    const studioApi = api();
    render(<CarouselStudio api={studioApi as never} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "New creation" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Example library" }));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(studioApi.createProject).not.toHaveBeenCalled();
    const example = screen.getByText("A moment of understanding").closest("button");
    expect(example).not.toBeNull();
    fireEvent.click(example!);
    expect(screen.getByRole("button", { name: /Select slide 1: A moment of understanding/ })).toBeInTheDocument();
  });

  it("keeps a valid slide while naming an invalid image in the upload error", async () => {
    vi.stubGlobal("Image", class {
      naturalWidth = 1129;
      naturalHeight = 1393;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:valid-slide");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    render(<CarouselStudio api={api() as never} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "New creation" })).toBeEnabled());
    const good = new File(["image"], "Good.png", { type: "image/png" });
    const bad = new File(["oops"], "Bad.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload carousel images"), {
      target: { files: [good, bad] },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Select slide 1: Good/ })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Bad.txt");
  });

  it("shows a recoverable blank start for an inaccessible creation link", async () => {
    window.history.replaceState(null, "", `/?carousel=${projectId}`);
    const studioApi = api();
    studioApi.listCarouselCreations.mockResolvedValue([]);
    render(<CarouselStudio api={studioApi as never} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be found/i));
    expect(screen.getByRole("button", { name: "New creation" })).toBeInTheDocument();
    expect(screen.getByText("Paste or upload your images")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New creation" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("moves keyboard focus into and out of the creation drawer", async () => {
    render(<CarouselStudio api={api() as never} />);
    const trigger = screen.getByRole("button", { name: "Creations" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close creations" })).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
