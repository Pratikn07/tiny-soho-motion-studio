"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  assertGenerationReady,
  carouselDocumentSchema,
  persistentSlide,
  planSnapshot,
  type CarouselDocument,
  type CarouselProject,
  type CarouselRun,
} from "../../lib/carousel";
import { getVideoModelContract } from "../../lib/video-catalog";
import type { Slide } from "./model";
import type { CarouselCreationSummary } from "../../lib/carousel-creations";
export type CarouselApi = {
  listCarouselCreations(): Promise<CarouselCreationSummary[]>;
  createProject(input: {
    name: string;
    canvas: string;
  }): Promise<{ id: string }>;
  listAcknowledgements(): Promise<
    Array<{ modelId: string; contractVersion: string }>
  >;
  acknowledgeModel(input: {
    modelId: string;
    contractVersion: string;
  }): Promise<unknown>;
  getCarousel(id: string): Promise<CarouselProject>;
  saveCarousel(
    id: string,
    revision: number,
    document: CarouselDocument,
  ): Promise<CarouselProject>;
  uploadCarouselImage(
    projectId: string,
    file: File,
  ): Promise<{ id: string; width: number; height: number }>;
  assetUrl(id: string): Promise<string>;
  analyzeCarousel(id: string): Promise<
    import("../../lib/carousel-analysis").CarouselAnalysis
  >;
  generateCarousel(
    projectId: string,
    slideId: string,
    runId: string,
  ): Promise<{ id: string; status: string; errorMessage?: string | null }>;
  getJob(
    id: string,
  ): Promise<{ id: string; status: string; errorMessage?: string | null }>;
  composeCarousel(
    projectId: string,
    slideId: string,
    runId: string,
  ): Promise<{
    id: string;
    status: string;
    outputAssetIds: string[];
    errorMessage?: string | null;
  }>;
  getVisionJob(id: string): Promise<{
    id: string;
    status: string;
    outputAssetIds: string[];
    errorMessage?: string | null;
  }>;
};
const terminal = new Set(["failed", "needs_attention", "canceled"]);
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";
export function useCarouselWorkspace(
  api: CarouselApi | undefined,
  slides: Slide[],
  setSlides: (slides: Slide[]) => void,
  name: string,
  setName: (name: string) => void,
) {
  const [creations, setCreations] = useState<CarouselCreationSummary[]>(
    [],
  );
  const [project, setProject] = useState<CarouselProject | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("Ready to begin"),
    [error, setError] = useState("");
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const live = useRef({ slides, name });
  live.current = { slides, name };
  const pausedRuns = useRef(new Set<string>());
  const projectRef = useRef(project),
    locked = useRef(false),
    inFlight = useRef<Promise<boolean> | null>(null),
    mounted = useRef(true),
    saved = useRef("");
  const model = getVideoModelContract("wan2.7-i2v")!;
  const serialize = (ss: Slide[], n: string) =>
    JSON.stringify({ name: n, slides: ss.map(persistentSlide) });
  const signature = (() => {
    try {
      return serialize(slides, name);
    } catch {
      return "";
    }
  })();
  const dirty = project
    ? !signature || signature !== saved.current
    : slides.length > 0;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const adoptProject = (p: CarouselProject) => {
    projectRef.current = p;
    setProject(p);
  };
  const setLocation = (id: string | null, mode: "push" | "replace") => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("carousel", id);
    else url.searchParams.delete("carousel");
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
  };
  async function hydrate(p: CarouselProject) {
    if (!api) return;
    const result = await Promise.all(
      p.document.slides.map(async (slide) => ({
        ...slide,
        src: await api.assetUrl(slide.assetId),
        ...(slide.run?.outputAssetId
          ? { video: await api.assetUrl(slide.run.outputAssetId) }
          : {}),
      })),
    );
    if (!mounted.current) return;
    saved.current = JSON.stringify(carouselDocumentSchema.parse(p.document));
    adoptProject(p);
    setName(p.document.name);
    setSlides(result);
    setStatus("Saved to your workspace");
    setRunStatus({});
    pausedRuns.current.clear();
  }
  const refreshCreations = useCallback(async () => {
    if (api) setCreations(await api.listCarouselCreations());
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let canceled = false;
    locked.current = true;
    setBusy(true);
    // Video acknowledgement availability must not block opening image drafts.
    Promise.all([
      api.listCarouselCreations(),
      api.listAcknowledgements().catch(() => []),
    ])
      .then(async ([list, acks]) => {
        if (canceled) return;
        setCreations(list);
        const previous = new URL(window.location.href).searchParams.get(
          "carousel",
        );
        if (previous) {
          if (!list.some((p) => p.id === previous))
            throw new Error("This creation could not be found. Start a new creation or choose one from your history.");
          await hydrate(await api.getCarousel(previous));
        }
        if (canceled) return;
        setAcknowledged(
          acks.some(
            (a) =>
              a.modelId === model.id &&
              a.contractVersion === model.contractVersion,
          ),
        );
      })
      .catch((e) => {
        if (!canceled) setError(errorMessage(e));
      })
      .finally(() => {
        locked.current = false;
        if (!canceled) setBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, model.id, model.contractVersion]);
  async function exclusive(
    action: () => Promise<void>,
    onError?: (message: string) => void,
  ): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    const operation = (async () => {
      try {
        await action();
        return true;
      } catch (e) {
        if (mounted.current) {
          setError(errorMessage(e));
          setStatus("Needs attention");
          onError?.(errorMessage(e));
        }
        return false;
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
    inFlight.current = operation;
    const success = await operation;
    if (inFlight.current === operation) inFlight.current = null;
    return success;
  }
  async function persist(
    inputSlides = live.current.slides,
    inputName = live.current.name,
  ) {
    if (!api) throw new Error("Sign in to the hosted Studio to save.");
    // Analysis and generation pass an intentional new snapshot to persist.
    if (inputSlides !== live.current.slides) {
      live.current = { ...live.current, slides: inputSlides };
      setSlides(inputSlides);
    }
    let p = projectRef.current;
    if (!p) {
      const created = await api.createProject({
        name: inputName.trim() || "Untitled creation",
        canvas: "1080x1350",
      });
      p = {
        id: created.id,
        revision: 0,
        document: { name: inputName, slides: [] },
      };
      adoptProject(p);
    }
    const uploaded: Slide[] = [];
    for (const slide of inputSlides) {
      if (slide.assetId) {
        uploaded.push(slide);
        continue;
      }
      const response = await fetch(slide.src);
      if (!response.ok)
        throw new Error("Could not read a local slide. Upload it again.");
      const blob = await response.blob();
      const asset = await api.uploadCarouselImage(
        p.id,
        new File(
          [blob],
          `${slide.name}.${blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png"}`,
          { type: blob.type },
        ),
      );
      uploaded.push({
        ...slide,
        assetId: asset.id,
        width: asset.width,
        height: asset.height,
      });
      // Retain successful uploads even if a later upload/save fails.
      const checkpoint = live.current.slides.map((current) =>
        current.id === slide.id
          ? {
              ...current,
              assetId: asset.id,
              width: asset.width,
              height: asset.height,
            }
          : current,
      );
      live.current = { ...live.current, slides: checkpoint };
      setSlides(checkpoint);
    }
    const document: CarouselDocument = {
      name: inputName.trim() || "Untitled creation",
      slides: uploaded.map(persistentSlide),
    };
    const next = await api.saveCarousel(p.id, p.revision, document);
    if (!mounted.current) return next;
    saved.current = JSON.stringify(carouselDocumentSchema.parse(next.document));
    adoptProject(next);
    if (live.current.name === inputName) {
      setName(next.document.name);
      live.current = { ...live.current, name: next.document.name };
    }
    if (
      new URL(window.location.href).searchParams.get("carousel") !== next.id
    ) {
      setLocation(next.id, "replace");
    }
    setStatus("Saved to your workspace");
    setCreations((all) => [
      { id: next.id, name: next.document.name, updatedAt: new Date().toISOString(), slideCount: next.document.slides.length },
      ...all.filter((x) => x.id !== next.id),
    ]);
    return next;
  }
  const save = () =>
    exclusive(async () => {
      if (!projectRef.current && !live.current.slides.length) return;
      setStatus("Saving images and story…");
      await persist();
    });
  useEffect(() => {
    if (!api || !dirty || busy || error) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
    // Use the current draft signature; URLs do not count as edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, project?.id, signature, dirty, busy, error]);
  useEffect(() => {
    if (!dirty || !api) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, api]);
  const switchTo = async (id: string | null, mode: "push" | "pop") => {
    if (!api) return false;
    if (inFlight.current && !(await inFlight.current)) return false;
    if (locked.current) return false;
    const currentId = projectRef.current?.id ?? null;
    if (id === currentId && (id !== null || !live.current.slides.length)) {
      if (id === null) {
        setError("");
        setStatus("Ready to begin");
        if (
          mode === "push" &&
          new URL(window.location.href).searchParams.has("carousel")
        ) {
          setLocation(null, "push");
        }
      }
      return true;
    }
    return exclusive(async () => {
      const current = live.current;
      if (projectRef.current
        ? serialize(current.slides, current.name) !== saved.current
        : current.slides.length > 0) {
        setStatus("Saving before switching creations…");
        try {
          await persist(current.slides, current.name);
        } catch (error) {
          throw new Error(`Could not save before switching creations: ${errorMessage(error)}`);
        }
      }
      if (id) {
        setStatus("Opening creation…");
        await hydrate(await api.getCarousel(id));
      } else {
        projectRef.current = null;
        setProject(null);
        saved.current = "";
        live.current = { slides: [], name: "Untitled creation" };
        setSlides([]);
        setName("Untitled creation");
        setRunStatus({});
        pausedRuns.current.clear();
        setStatus("Ready to begin");
      }
      if (mode === "push") setLocation(id, "push");
    });
  };
  const open = (id: string) => switchTo(id, "push");
  const startNew = () => switchTo(null, "push");
  useEffect(() => {
    if (!api) return;
    const onPopState = () => {
      const previous = projectRef.current?.id ?? null;
      const target = new URL(window.location.href).searchParams.get("carousel");
      void switchTo(target, "pop").then((success) => {
        if (!success) setLocation(previous, "replace");
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // Navigation uses refs for current state; listener identity follows the API session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const analyze = (id: string) =>
    exclusive(async () => {
      if (!api) return;
      setStatus("Saving before analysis…");
      await persist();
      const slide = live.current.slides.find((s) => s.id === id)!;
      setStatus("Reading the image…");
      const result = await api.analyzeCarousel(slide.assetId!);
      const suggestions = result.stories.map((story, i) => ({
        ...story,
        id: `analysis-${i}`,
      }));
      const manualPlacement = result.placement === "manual";
      const manualNote =
        "This story needs manual placement. Mark every text area and set the movement area yourself.";
      const next = live.current.slides.map((s) =>
        s.id !== id
          ? s
          : {
              ...s,
              region: manualPlacement ? s.region : result.region,
              protectedRegions: manualPlacement
                ? s.protectedRegions
                : result.protectedRegions,
              suggestions,
              story: suggestions[0].prompt,
              selectedStory: suggestions[0].id,
              analysisSummary: manualPlacement
                ? `${result.summary.slice(0, 1000)} ${manualNote}`
                : result.summary,
              reviewed: false,
            },
      );
      setSlides(next);
      await persist(next);
      setStatus(
        manualPlacement
          ? "Story saved. Mark text and movement areas before review."
          : "Suggestions saved. Review the words and movement area.",
      );
    });
  const acknowledge = () =>
    exclusive(async () => {
      if (api) {
        await api.acknowledgeModel({
          modelId: model.id,
          contractVersion: model.contractVersion,
        });
        setAcknowledged(true);
      }
    });
  const generate = (id: string) =>
    exclusive(async () => {
      if (!api) return;
      const slide = live.current.slides.find((s) => s.id === id)!;
      assertGenerationReady(slide);
      if (!acknowledged)
        throw new Error(
          "Review the WAN billing acknowledgement before generating.",
        );
      await persist();
      const source = live.current.slides.find((s) => s.id === id)!;
      const run: CarouselRun = {
        id: crypto.randomUUID(),
        composeKey: crypto.randomUUID(),
        snapshot: planSnapshot(source),
      };
      const next = live.current.slides.map((s) =>
        s.id === id ? { ...s, run, video: undefined } : s,
      );
      await persist(next);
      setRunStatus((all) => ({ ...all, [id]: "Preparing your video…" }));
    });
  // Resume from the persisted run. Every external submission has a stable idempotency key.
  useEffect(() => {
    if (!api || !project) return;
    let stopped = false;
    async function tick() {
      if (stopped || locked.current) return;
      const p = projectRef.current;
      if (!p) return;
      let serialized = "";
      try {
        serialized = serialize(live.current.slides, live.current.name);
      } catch {
        return;
      }
      if (serialized !== saved.current) return;
      const slide = live.current.slides.find(
        (s) =>
          s.run && !s.run.outputAssetId && !pausedRuns.current.has(s.run.id),
      );
      if (!slide?.run) return;
      await exclusive(
        async () => {
          const run = { ...slide.run! };
          const patchRun = async () => {
            if (stopped) return;
            await persist(
              live.current.slides.map((s) =>
                s.id === slide.id ? { ...s, run } : s,
              ),
            );
          };
          const job = run.jobId
            ? await api!.getJob(run.jobId)
            : await api!.generateCarousel(p.id, slide.id, run.id);
          if (stopped) return;
          if (!run.jobId) {
            run.jobId = job.id;
            await patchRun();
          }
          if (terminal.has(job.status))
            throw new Error(
              job.errorMessage ||
                `Video ${job.status}. Review the plan before starting another generation.`,
            );
          if (job.status !== "completed") {
            setRunStatus((all) => ({
              ...all,
              [slide.id]: `Video ${job.status.replaceAll("_", " ")}…`,
            }));
            return;
          }
          const composed = run.composeJobId
            ? await api!.getVisionJob(run.composeJobId)
            : await api!.composeCarousel(p.id, slide.id, run.id);
          if (stopped) return;
          if (!run.composeJobId) {
            run.composeJobId = composed.id;
            await patchRun();
          }
          if (terminal.has(composed.status))
            throw new Error(
              composed.errorMessage || "Composition needs attention.",
            );
          if (composed.status !== "completed") {
            setRunStatus((all) => ({
              ...all,
              [slide.id]: "Restoring your original artwork…",
            }));
            return;
          }
          if (!composed.outputAssetIds[0])
            throw new Error("Composition returned no downloadable video.");
          run.outputAssetId = composed.outputAssetIds[0];
          const url = await api!.assetUrl(run.outputAssetId);
          if (stopped) return;
          await persist(
            live.current.slides.map((s) =>
              s.id === slide.id ? { ...s, run, video: url } : s,
            ),
          );
          setRunStatus((all) => ({
            ...all,
            [slide.id]: "Ready for visual review",
          }));
        },
        (message) => {
          pausedRuns.current.add(slide.run!.id);
          setRunStatus((all) => ({
            ...all,
            [slide.id]: `Needs attention: ${message}`,
          }));
        },
      );
    }
    // Error handling is kept visible; do not automatically resubmit terminal failures.
    const timer = setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // Project revision changes during polling; only project identity starts/stops this loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, project?.id]);
  // Refresh signed links without changing the persisted document or clobbering edits.
  useEffect(() => {
    if (!api) return;
    const timer = setInterval(() => {
      if (locked.current) return;
      const current = live.current.slides;
      Promise.all(
        current.map(async (s) => ({
          ...s,
          ...(s.assetId ? { src: await api.assetUrl(s.assetId) } : {}),
          ...(s.run?.outputAssetId
            ? { video: await api.assetUrl(s.run.outputAssetId) }
            : {}),
        })),
      )
        .then((fresh) => {
          if (mounted.current && live.current.slides === current)
            setSlides(fresh);
        })
        .catch(() => {});
    }, 180000);
    return () => clearInterval(timer);
  }, [api, setSlides]);
  const retry = (id: string) =>
    exclusive(async () => {
      const next = live.current.slides.map((s) =>
        s.id === id ? { ...s, run: undefined, reviewed: false } : s,
      );
      await persist(next);
      setRunStatus((all) => ({ ...all, [id]: "" }));
    });
  const resume = (id: string) => {
    const run = live.current.slides.find((s) => s.id === id)?.run;
    if (run) {
      pausedRuns.current.delete(run.id);
      setRunStatus((all) => ({ ...all, [id]: "Resuming saved request…" }));
      setError("");
    }
  };
  return {
    creations,
    project,
    busy,
    status,
    error,
    dirty,
    runStatus,
    acknowledged,
    save,
    open,
    startNew,
    analyze,
    acknowledge,
    generate,
    refreshCreations,
    resume,
    retry,
  };
}
