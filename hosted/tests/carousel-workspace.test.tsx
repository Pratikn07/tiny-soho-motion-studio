// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useCarouselWorkspace,
  type CarouselApi,
} from "@/components/carousel/useCarouselWorkspace";
import type { Slide } from "@/components/carousel/model";
import { getVideoModelContract } from "@/lib/video-catalog";
import { persistentSlide } from "@/lib/carousel";
const id = "11111111-1111-4111-8111-111111111111",
  projectId = "22222222-2222-4222-8222-222222222222",
  otherProjectId = "66666666-6666-4666-8666-666666666666";
const initial: Slide = {
  id,
  assetId: id,
  src: "https://image.test",
  width: 1000,
  height: 1250,
  name: "Recipe",
  origin: "upload",
  category: "Food",
  story: "A fork lifts a bite.",
  selectedStory: "",
  region: { x: 35, y: 35, width: 55, height: 40 },
  protectedRegions: [{ x: 0, y: 0, width: 100, height: 25 }],
  suggestions: [],
  reviewed: true,
};
function databaseOrder(value: any): any {
  if (Array.isArray(value)) return value.map(databaseOrder);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, databaseOrder(value[key])]));
  return value;
}
function setup({ slides = [initial], name = "Draft", acknowledgementUnavailable = false }: { slides?: Slide[]; name?: string; acknowledgementUnavailable?: boolean } = {}) {
  let stored: any = {
    id: projectId,
    revision: 0,
    document: { name: "Saved recipe", slides: [initial] },
  };
  const model = getVideoModelContract("wan2.7-i2v")!;
  const api = {
    listCarouselCreations: vi.fn().mockResolvedValue([{
      id: projectId, name: "Saved recipe", updatedAt: "2026-09-29T12:00:00.000Z", slideCount: 1,
    }]),
    listProjects: vi
      .fn()
      .mockResolvedValue([{ id: projectId, name: "Saved recipe" }]),
    listAcknowledgements: acknowledgementUnavailable
      ? vi.fn().mockRejectedValue(new Error("Acknowledgement service unavailable"))
      : vi.fn().mockResolvedValue([
          { modelId: model.id, contractVersion: model.contractVersion },
        ]),
    getCarousel: vi.fn(async () => stored),
    createProject: vi.fn().mockResolvedValue({ id: projectId }),
    uploadCarouselImage: vi.fn().mockResolvedValue({ id, width: 1000, height: 1250 }),
    assetUrl: vi.fn(async (id: string) => `https://asset.test/${id}`),
    saveCarousel: vi.fn(
      async (id: string, revision: number, document: unknown) => {
        if (revision !== stored.revision)
          throw new Error("changed in another tab");
        stored = { id, revision: revision + 1, document: databaseOrder(document) };
        return stored;
      },
    ),
    generateCarousel: vi.fn().mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      status: "running",
    }),
    getJob: vi.fn().mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      status: "running",
    }),
    composeCarousel: vi.fn(),
    getVisionJob: vi.fn(),
  } as unknown as CarouselApi;
  const hook = renderHook(() => {
    const [currentSlides, setSlides] = useState<Slide[]>(slides);
    const [currentName, setName] = useState(name);
    return {
      workspace: useCarouselWorkspace(api, currentSlides, setSlides, currentName, setName),
      slides: currentSlides,
      setSlides,
      name: currentName,
    };
  });
  return { api, ...hook, stored: () => stored };
}
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
describe("saved Carousel workspace", () => {
  it("does not create a record until the first accepted slide, then autosaves it once", async () => {
    const { result, api } = setup({ slides: [], name: "Untitled creation" });
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    expect(api.createProject).not.toHaveBeenCalled();
    expect(result.current.workspace.dirty).toBe(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["image"], { type: "image/png" }),
      { headers: { "Content-Type": "image/png" } },
    ));
    act(() => result.current.setSlides([{
      ...initial, assetId: undefined, src: "blob:local-upload", name: "First slide",
    }]));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(result.current.workspace.dirty).toBe(false));
    expect(api.uploadCarouselImage).toHaveBeenCalledTimes(1);
    expect(api.saveCarousel).toHaveBeenCalledTimes(1);
    expect(result.current.workspace.project?.id).toBe(projectId);
  });

  it("can open a saved image draft when model acknowledgement lookup is unavailable", async () => {
    window.history.replaceState(null, "", `/?carousel=${projectId}`);
    const { result } = setup({ acknowledgementUnavailable: true });
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    expect(result.current.workspace.project?.id).toBe(projectId);
    expect(result.current.slides[0].name).toBe("Recipe");
    expect(result.current.workspace.acknowledged).toBe(false);
    expect(result.current.workspace.error).toBe("");
  });

  it("retains edits made while the first upload is in flight and saves them next", async () => {
    const { result, api, stored } = setup({ slides: [], name: "Untitled creation" });
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["image"], { type: "image/png" }),
      { headers: { "Content-Type": "image/png" } },
    ));
    let finishUpload!: (value: { id: string; width: number; height: number }) => void;
    vi.mocked(api.uploadCarouselImage).mockReturnValueOnce(new Promise(resolve => { finishUpload = resolve; }));
    act(() => result.current.setSlides([{ ...initial, assetId: undefined, src: "blob:local-upload", story: "First idea" }]));
    await waitFor(() => expect(api.uploadCarouselImage).toHaveBeenCalledTimes(1), { timeout: 3000 });
    act(() => result.current.setSlides([{ ...result.current.slides[0], story: "Better idea" }]));
    await act(async () => finishUpload({ id, width: 1000, height: 1250 }));
    expect(result.current.slides[0].story).toBe("Better idea");
    await waitFor(() => expect(stored().document.slides[0].story).toBe("Better idea"), { timeout: 4000 });
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.uploadCarouselImage).toHaveBeenCalledTimes(1);
    expect(result.current.workspace.dirty).toBe(false);
  });

  it("keeps a failed first draft and blank URL until a successful retry", async () => {
    const { result, api } = setup({ slides: [], name: "Untitled creation" });
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new Blob(["image"], { type: "image/png" }),
      { headers: { "Content-Type": "image/png" } },
    ));
    vi.mocked(api.saveCarousel).mockRejectedValueOnce(new Error("Storage unavailable"));
    act(() => result.current.setSlides([{ ...initial, assetId: undefined, src: "blob:local-upload", story: "Keep this" }]));
    await waitFor(() => expect(result.current.workspace.error).toContain("Storage unavailable"), { timeout: 3000 });
    expect(window.location.search).toBe("");
    expect(result.current.slides[0].story).toBe("Keep this");
    await act(() => result.current.workspace.save());
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe(`?carousel=${projectId}`);
    expect(result.current.workspace.dirty).toBe(false);
  });

  it("keeps a dirty creation and its URL when switching would lose a failed save", async () => {
    const { result, api } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    act(() => result.current.setSlides([{ ...result.current.slides[0], story: "Keep this edit" }]));
    vi.mocked(api.saveCarousel).mockRejectedValueOnce(new Error("Save unavailable"));
    let switched = true;
    await act(async () => { switched = await result.current.workspace.startNew(); });
    expect(switched).toBe(false);
    expect(result.current.slides[0].story).toBe("Keep this edit");
    expect(result.current.workspace.project?.id).toBe(projectId);
    expect(window.location.search).toBe(`?carousel=${projectId}`);
    expect(result.current.workspace.error).toContain("Save unavailable");
  });

  it("starts a blank creation after saving edits and can reopen the old creation", async () => {
    const { result, api } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    act(() => result.current.setSlides([{ ...result.current.slides[0], story: "Saved before leaving" }]));
    await act(() => result.current.workspace.startNew());
    expect(api.saveCarousel).toHaveBeenCalled();
    expect(result.current.slides).toEqual([]);
    expect(result.current.name).toBe("Untitled creation");
    expect(result.current.workspace.project).toBeNull();
    expect(window.location.search).toBe("");
    await act(() => result.current.workspace.open(projectId));
    expect(result.current.slides[0].story).toBe("Saved before leaving");
  });

  it("saves before opening a different creation and keeps browser history navigable", async () => {
    const { result, api } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    act(() => result.current.setSlides([{ ...result.current.slides[0], story: "Saved before opening" }]));
    vi.mocked(api.getCarousel).mockImplementation(async (requestedId) => requestedId === otherProjectId
      ? { id: otherProjectId, revision: 1,
          document: { name: "Other creation", slides: [persistentSlide(initial)] } }
      : { id: projectId, revision: 1,
          document: { name: "Saved recipe", slides: [persistentSlide({ ...initial, story: "Saved before opening" })] } });
    await act(() => result.current.workspace.open(otherProjectId));
    expect(api.saveCarousel).toHaveBeenCalled();
    expect(result.current.workspace.project?.id).toBe(otherProjectId);
    expect(window.location.search).toBe(`?carousel=${otherProjectId}`);
    expect(result.current.name).toBe("Other creation");
  });

  it("restores the current URL when browser Back cannot save the draft", async () => {
    const { result, api } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    act(() => result.current.setSlides([{ ...result.current.slides[0], story: "Unsaved boundary" }]));
    vi.mocked(api.saveCarousel).mockRejectedValueOnce(new Error("Storage unavailable"));
    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(result.current.workspace.error).toContain("Storage unavailable"));
    expect(window.location.search).toBe(`?carousel=${projectId}`);
    expect(result.current.slides[0].story).toBe("Unsaved boundary");
  });

  it("opens the correct creation through Back and Forward without creating an empty record", async () => {
    const { result, api } = setup({ slides: [], name: "Untitled creation" });
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(async () => {
      window.history.replaceState(null, "", `/?carousel=${projectId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(result.current.workspace.project?.id).toBe(projectId));
    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(result.current.workspace.project).toBeNull());
    expect(result.current.slides).toEqual([]);
    await act(async () => {
      window.history.replaceState(null, "", `/?carousel=${projectId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(result.current.workspace.project?.id).toBe(projectId));
    expect(result.current.name).toBe("Saved recipe");
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it("shows recovery when a linked creation is not in the owner's history", async () => {
    window.history.replaceState(null, "", `/?carousel=${otherProjectId}`);
    const { result, api } = setup({ slides: [], name: "Untitled creation" });
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    expect(result.current.workspace.error).toMatch(/could not be found/i);
    expect(result.current.slides).toEqual([]);
    expect(api.getCarousel).not.toHaveBeenCalled();
  });
  it("keeps owner-drawn areas and requires review when analysis placement is uncertain", async () => {
    const { result, api, stored } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    api.analyzeCarousel = vi.fn().mockResolvedValue({
      summary: "Salmon cakes and recipe notes",
      stories: [{ title: "Fresh from the pan", prompt: "Steam rises from the cakes." }],
      placement: "manual",
      region: null,
      protectedRegions: [],
    });
    await act(() => result.current.workspace.analyze(id));
    expect(result.current.slides[0].region).toEqual(initial.region);
    expect(result.current.slides[0].protectedRegions).toEqual(initial.protectedRegions);
    expect(result.current.slides[0].reviewed).toBe(false);
    expect(result.current.slides[0].story).toBe("Steam rises from the cakes.");
    expect(result.current.slides[0].analysisSummary).toMatch(/mark.*area/i);
    expect(stored().document.slides[0].reviewed).toBe(false);
  });
  it("reopens durable source IDs with fresh URLs on refresh and keeps edited story after saving", async () => {
    window.history.replaceState(null, "", `/?carousel=${projectId}`);
    const { result, api, stored } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    expect(result.current.name).toBe("Saved recipe");
    expect(result.current.slides[0].src).toBe(`https://asset.test/${id}`);
    act(() =>
      result.current.setSlides([
        { ...result.current.slides[0], story: "A new action", reviewed: false },
      ]),
    );
    await act(() => result.current.workspace.save());
    expect(stored().document.slides[0].story).toBe("A new action");
    expect(stored().document.slides[0].src).toBeUndefined();
    expect(api.generateCarousel).not.toHaveBeenCalled();
  });
  it("keeps unsaved changes when a stale revision is rejected", async () => {
    const { result, api } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    vi.mocked(api.saveCarousel).mockRejectedValueOnce(
      new Error("changed in another tab"),
    );
    act(() =>
      result.current.setSlides([
        { ...result.current.slides[0], story: "Keep this local action" },
      ]),
    );
    await act(() => result.current.workspace.save());
    expect(result.current.workspace.error).toContain("another tab");
    expect(result.current.slides[0].story).toBe("Keep this local action");
  });
  it("persists immutable keys before provider submission and prevents unreviewed generation", async () => {
    const { result, stored } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    await act(() => result.current.workspace.open(projectId));
    act(() =>
      result.current.setSlides([
        { ...result.current.slides[0], reviewed: false },
      ]),
    );
    await act(() => result.current.workspace.generate(id));
    expect(result.current.workspace.error).toMatch(/review/i);
    expect(stored().document.slides[0].run).toBeUndefined();
    act(() =>
      result.current.setSlides([
        { ...result.current.slides[0], reviewed: true },
      ]),
    );
    await act(() => result.current.workspace.generate(id));
    expect(stored().document.slides[0].run.snapshot.story).toBe(initial.story);
    expect(stored().document.slides[0].run.id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("recovers a lost submit response with the same key and persists the finished video", async () => {
    const { result, api, stored } = setup();
    await waitFor(() => expect(result.current.workspace.busy).toBe(false));
    vi.useFakeTimers();
    try {
      await act(() => result.current.workspace.open(projectId));
      vi.mocked(api.generateCarousel)
        .mockRejectedValueOnce(new Error("Connection interrupted"))
        .mockResolvedValue({
          id: "33333333-3333-4333-8333-333333333333",
          status: "completed",
        });
      vi.mocked(api.getJob).mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333",
        status: "completed",
      });
      vi.mocked(api.composeCarousel).mockResolvedValue({
        id: "44444444-4444-4444-8444-444444444444",
        status: "completed",
        outputAssetIds: ["55555555-5555-4555-8555-555555555555"],
      });
      await act(() => result.current.workspace.generate(id));
      const key = stored().document.slides[0].run.id;
      await act(() => vi.advanceTimersByTimeAsync(4000));
      expect(result.current.workspace.error).toContain(
        "Connection interrupted",
      );
      act(() => result.current.workspace.resume(id));
      await act(() => vi.advanceTimersByTimeAsync(4000));
      expect(
        vi.mocked(api.generateCarousel).mock.calls.map((c) => c[2]),
      ).toEqual([key, key]);
      expect(stored().document.slides[0].run.outputAssetId).toBe(
        "55555555-5555-4555-8555-555555555555",
      );
      expect(result.current.slides[0].video).toContain("55555555");
      expect(JSON.stringify(stored())).not.toContain("https://");
    } finally {
      vi.useRealTimers();
    }
  });
});

it("preserves an initial upload when opening another project until it is saved", async () => {
  const { result, api } = setup();
  await waitFor(() => expect(result.current.workspace.busy).toBe(false));
  act(() =>
    result.current.setSlides([
      {
        ...initial,
        assetId: undefined,
        src: "blob:local-upload",
        story: "Keep my new upload",
      },
    ]),
  );
  await act(() => result.current.workspace.open(projectId));
  expect(api.getCarousel).not.toHaveBeenCalled();
  expect(result.current.slides[0].story).toBe("Keep my new upload");
  expect(result.current.workspace.error).toMatch(/save/i);
});

it("settles after the database reorders saved JSON fields", async () => {
  window.history.replaceState(null, "", `/?carousel=${projectId}`);
  const { result, api } = setup();
  await waitFor(() => expect(result.current.workspace.busy).toBe(false));
  act(() => result.current.setSlides([{...result.current.slides[0], story: "Saved once"}]));
  await act(() => result.current.workspace.save());
  expect(result.current.workspace.dirty).toBe(false);
  expect(api.saveCarousel).toHaveBeenCalledTimes(1);
});
