// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { contractFixtures } from "@/lib/contract/fixtures";
import { CreationApiError, type CreationApi } from "@/components/creation/api";
import { createMockCreationApi } from "@/components/creation/mock-api";
import { RunProgress } from "@/components/creation/takes/RunProgress";
import { useRun } from "@/components/creation/takes/useRun";
import { TakesPanel } from "@/components/creation/takes/TakesPanel";
import {
  downloadTake,
  downloadChosen,
} from "@/components/creation/export/download";
import { useCreation } from "@/components/creation/useCreation";
import { CreationShell } from "@/components/creation/CreationShell";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const completed = () => structuredClone(contractFixtures.runCompleted.run);
const apiFor = (reply: unknown = { run: completed() }) => ({
  ...createMockCreationApi(),
  fetchJson: vi.fn<CreationApi["fetchJson"]>(async () => reply),
});

it.each([
  ["queued", "Waiting for the GPU"],
  ["generating", "Animating"],
  ["finishing", "Adding your text"],
  ["checking", "Checking"],
  ["completed", "Ready"],
  ["needs_attention", "Needs a look"],
  ["failed", "Needs a look"],
  ["canceled", "Canceled"],
] as const)("explains %s in the creator's words", (status, label) => {
  render(
    <RunProgress
      run={{
        ...completed(),
        status,
        reasons: status === "needs_attention" ? ["Try a calmer motion."] : [],
      }}
    />,
  );
  expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
  expect(screen.getByText(/Take 2 of 3/)).toHaveTextContent("$0.06");
  if (status === "needs_attention")
    expect(screen.getByText("Try a calmer motion.")).toBeInTheDocument();
});

it("recovers persisted runs, polls at four seconds, stops on terminal status and refreshes on focus", async () => {
  vi.useFakeTimers();
  const run = completed(),
    api = apiFor();
  api.fetchJson
    .mockResolvedValueOnce({ run: { ...run, status: "generating" } })
    .mockResolvedValue({ run });
  const hook = renderHook(() => useRun(api, run.id));
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.run?.status).toBe("generating");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3999);
  });
  expect(api.fetchJson).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(hook.result.current.run?.status).toBe("completed");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(api.fetchJson).toHaveBeenCalledTimes(2);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(api.fetchJson).toHaveBeenCalledTimes(3);
  hook.unmount();
  renderHook(() => useRun(api, run.id));
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.fetchJson).toHaveBeenCalledTimes(4);
});

it("drops late run replies after switching slides", async () => {
  const first = completed(),
    next = { ...completed(), id: "11111111-1111-4111-8111-111111111111" };
  let resolveFirst!: (reply: unknown) => void;
  const api = apiFor();
  api.fetchJson
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({ run: next });
  const hook = renderHook(({ id }) => useRun(api, id), {
    initialProps: { id: first.id },
  });
  hook.rerender({ id: next.id });
  await waitFor(() => expect(hook.result.current.run?.id).toBe(next.id));
  await act(async () => {
    resolveFirst({ run: first });
  });
  expect(hook.result.current.run?.id).toBe(next.id);
});

it("keeps a playing take's valid signed URL stable across progress polls", async () => {
  vi.useFakeTimers();
  const run = completed();
  run.status = "generating";
  run.takes.forEach((take) => {
    take.urlsExpireAt = new Date(Date.now() + 300000).toISOString();
  });
  const fresh = structuredClone(run);
  fresh.takes.forEach((take) => {
    take.finalVideoUrl = `${take.finalVideoUrl}&renewed=1`;
  });
  const api = apiFor();
  api.fetchJson
    .mockResolvedValueOnce({ run })
    .mockResolvedValue({ run: fresh });
  const hook = renderHook(() => useRun(api, run.id));
  await act(async () => {
    await Promise.resolve();
  });
  const original = hook.result.current.run!.takes[1].finalVideoUrl;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(api.fetchJson).toHaveBeenCalledTimes(2);
  expect(hook.result.current.run!.takes[1].finalVideoUrl).toBe(original);
});

it("reopens a ten-slide creation, chooses every take without losing an edit, and downloads in order", async () => {
  const { mockTakes, getMockRunningSlides } = await import(
    "@/components/creation/takes/mock-routes"
  );
  const { within } = await import("@testing-library/react");
  mockTakes.runs.clear();
  mockTakes.autoAdvance = false;
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:sample");
  URL.revokeObjectURL = vi.fn();
  const api = createMockCreationApi({ running: getMockRunningSlides });
  const initial = await api.createCreation("Ten slides");
  const slides = Array.from({ length: 10 }, (_, index) => {
    const run = completed(),
      slide = {
        ...structuredClone(contractFixtures.creation.document.slides[0]),
        id: crypto.randomUUID(),
        name: `slide-${index + 1}`,
        order: index,
        latestRunId: crypto.randomUUID(),
      };
    delete slide.chosenTakeId;
    Object.assign(run, {
      id: slide.latestRunId,
      projectId: initial.id,
      slideId: slide.id,
      status: index < 2 ? "generating" : "completed",
    });
    run.takes.forEach((take) => {
      take.id = crypto.randomUUID();
    });
    mockTakes.runs.set(run.id, run);
    return slide;
  });
  await api.saveCreation(initial.id, initial.revision, {
    ...initial.document,
    slides,
  });
  window.history.replaceState(
    null,
    "",
    `/?studio=creation&creation=${initial.id}`,
  );
  const first = render(<CreationShell api={api} />);
  expect(await screen.findByText("2 slides in progress")).toBeInTheDocument();
  const panel = () =>
    within(screen.getByRole("region", { name: "Takes and downloads" }));
  expect(
    await panel().findByText("Animating", { exact: true }),
  ).toBeInTheDocument();
  first.unmount();
  mockTakes.runs.forEach((run) => {
    run.status = "completed";
  });
  render(<CreationShell api={api} />);
  await screen.findByRole("region", { name: "Takes and downloads" });
  await panel().findByText("Ready", { exact: true });
  fireEvent.change(screen.getByRole("textbox", { name: "Creation name" }), {
    target: { value: "Saved with choices" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "Creation name" }));
  for (let i = 0; i < slides.length; i++) {
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Slide ${i + 1}:`) }),
    );
    fireEvent.click(
      await panel().findByRole("button", { name: "Choose this take" }),
    );
    await waitFor(async () =>
      expect(
        (await api.getCreation(initial.id)).document.slides[i].chosenTakeId,
      ).toBe(mockTakes.runs.get(slides[i].latestRunId)!.takes[1].id),
    );
  }
  const saved = await api.getCreation(initial.id);
  expect(saved.document.name).toBe("Saved with choices");
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
  fireEvent.click(
    panel().getByRole("button", { name: "Download all chosen clips (10)" }),
  );
  await waitFor(() => expect(names).toHaveLength(10));
  expect(names).toEqual(
    slides.map((s, i) => `${String(i + 1).padStart(2, "0")}-${s.name}.mp4`),
  );
  vi.unstubAllGlobals();
  mockTakes.runs.clear();
  mockTakes.autoAdvance = true;
});

it("collapses rejected takes, queues the chosen take and explains a budget-refused retry", async () => {
  const run = completed(),
    creation = structuredClone(contractFixtures.creation);
  delete creation.document.slides[0].chosenTakeId;
  const api = apiFor(),
    saveServerStep = vi.fn(async (change: any) => {
      await change(creation);
    });
  api.fetchJson.mockImplementation(async (path, init) => {
    if (path.endsWith("/choose"))
      return {
        ...creation,
        revision: creation.revision + 1,
        document: {
          ...creation.document,
          slides: creation.document.slides.map((s) =>
            s.id === run.slideId ? { ...s, chosenTakeId: run.takes[1].id } : s,
          ),
        },
      };
    if (path.endsWith("/retry"))
      throw new CreationApiError(
        402,
        "budget_exceeded",
        "This would go over your monthly budget.",
      );
    return { run };
  });
  render(
    <TakesPanel
      creation={creation}
      slide={creation.document.slides[0]}
      ready
      api={api}
      edit={() => {}}
      editSlide={() => {}}
      saveServerStep={saveServerStep}
    />,
  );
  await screen.findByRole("button", { name: "Choose this take" });
  const rejected = screen.getByText(
    "The child moved behind 'Start with the basics:' at 1.0 s.",
  );
  expect(rejected.closest("details")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Choose this take" }));
  await waitFor(() =>
    expect(api.fetchJson).toHaveBeenCalledWith(
      `/api/creations/${creation.id}/slides/${run.slideId}/choose`,
      {
        method: "POST",
        body: { revision: creation.revision, takeId: run.takes[1].id },
      },
    ),
  );
  expect(saveServerStep).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Try another take" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("monthly budget");
});

it("downloads fresh signed clips and covers, including all chosen slides in order", async () => {
  const run = completed();
  run.takes.forEach((t) => {
    t.finalVideoUrl = "https://example.com/fresh.mp4";
    t.coverUrl = "https://example.com/fresh.png";
    t.urlsExpireAt = new Date(Date.now() + 300000).toISOString();
  });
  const api = apiFor({ run }),
    save = vi.fn(async () => {});
  await downloadTake(api, run.id, run.takes[1].id, "clip", "potty", save);
  await downloadTake(api, run.id, run.takes[1].id, "cover", "potty", save);
  expect(save).toHaveBeenNthCalledWith(
    1,
    "https://example.com/fresh.mp4",
    "potty.mp4",
  );
  expect(save).toHaveBeenNthCalledWith(
    2,
    "https://example.com/fresh.png",
    "potty-cover.png",
  );
  const slides = [
    {
      ...contractFixtures.creation.document.slides[0],
      order: 1,
      name: "second",
    },
    {
      ...contractFixtures.creation.document.slides[0],
      order: 0,
      name: "first",
    },
  ];
  await downloadChosen(api, slides, save);
  expect(save).toHaveBeenNthCalledWith(
    3,
    "https://example.com/fresh.mp4",
    "01-first.mp4",
  );
  expect(save).toHaveBeenNthCalledWith(
    4,
    "https://example.com/fresh.mp4",
    "02-second.mp4",
  );
  expect(api.fetchJson).toHaveBeenCalledTimes(4);
});

it("never replaces the newly opened creation with a late selection response", async () => {
  const api = apiFor(),
    first = structuredClone(contractFixtures.creation),
    next = {
      ...structuredClone(first),
      id: "11111111-1111-4111-8111-111111111111",
    };
  const hook = renderHook(() => useCreation(api));
  await act(async () => {
    hook.result.current.open(first);
  });
  let answer!: () => void;
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook.result.current
      .step(async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return { creation: first, value: null };
      })
      .catch(() => null);
    await Promise.resolve();
  });
  await act(async () => {
    hook.result.current.open(next);
    answer();
    await pending;
  });
  expect(hook.result.current.view?.id).toBe(next.id);
});
