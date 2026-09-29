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
const id = "11111111-1111-4111-8111-111111111111",
  projectId = "22222222-2222-4222-8222-222222222222";
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
function setup() {
  let stored: any = {
    id: projectId,
    revision: 0,
    document: { name: "Saved recipe", slides: [initial] },
  };
  const model = getVideoModelContract("wan2.7-i2v")!;
  const api = {
    listProjects: vi
      .fn()
      .mockResolvedValue([{ id: projectId, name: "Saved recipe" }]),
    listAcknowledgements: vi
      .fn()
      .mockResolvedValue([
        { modelId: model.id, contractVersion: model.contractVersion },
      ]),
    getCarousel: vi.fn(async () => stored),
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
    const [slides, setSlides] = useState<Slide[]>([initial]);
    const [name, setName] = useState("Draft");
    return {
      workspace: useCarouselWorkspace(api, slides, setSlides, name, setName),
      slides,
      setSlides,
      name,
    };
  });
  return { api, ...hook, stored: () => stored };
}
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
describe("saved Carousel workspace", () => {
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
