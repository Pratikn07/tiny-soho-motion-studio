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
export type CarouselApi = {
  listProjects(): Promise<Array<{ id: string; name: string }>>;
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
  analyzeCarousel(id: string): Promise<{
    summary: string;
    stories: Array<{ title: string; prompt: string }>;
    region: Slide["region"];
    protectedRegions: Slide["region"][];
  }>;
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
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [project, setProject] = useState<CarouselProject | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("Unsaved project"),
    [error, setError] = useState("");
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const live = useRef({ slides, name });
  live.current = { slides, name };
  const initialDraft = useRef(JSON.stringify({ slides, name }));
  const pausedRuns = useRef(new Set<string>());
  const projectRef = useRef(project),
    locked = useRef(false),
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
  const dirty = !project || !signature || signature !== saved.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const adoptProject = (p: CarouselProject) => {
    projectRef.current = p;
    setProject(p);
    const url = new URL(window.location.href);
    url.searchParams.set("carousel", p.id);
    window.history.replaceState(null, "", url);
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
  }
  const refreshProjects = useCallback(async () => {
    if (api) setProjects(await api.listProjects());
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let canceled = false;
    locked.current = true;
    setBusy(true);
    Promise.all([api.listProjects(), api.listAcknowledgements()])
      .then(async ([list, acks]) => {
        if (canceled) return;
        setProjects(list);
        const previous = new URL(window.location.href).searchParams.get(
          "carousel",
        );
        if (previous && list.some((p) => p.id === previous))
          await hydrate(await api.getCarousel(previous));
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
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (mounted.current) {
        setError(errorMessage(e));
        setStatus("Needs attention");
        onError?.(errorMessage(e));
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function persist(
    inputSlides = live.current.slides,
    inputName = live.current.name,
  ) {
    if (!api) throw new Error("Sign in to the hosted Studio to save.");
    let p = projectRef.current;
    if (!p) {
      const created = await api.createProject({
        name: inputName.trim() || "Untitled carousel",
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
      const checkpoint = [...uploaded, ...inputSlides.slice(uploaded.length)];
      live.current = { slides: checkpoint, name: inputName };
      setSlides(checkpoint);
    }
    const document: CarouselDocument = {
      name: inputName.trim() || "Untitled carousel",
      slides: uploaded.map(persistentSlide),
    };
    const next = await api.saveCarousel(p.id, p.revision, document);
    if (!mounted.current) return next;
    saved.current = JSON.stringify(carouselDocumentSchema.parse(next.document));
    adoptProject(next);
    setSlides(uploaded);
    setName(next.document.name);
    live.current = { slides: uploaded, name: next.document.name };
    setStatus("Saved to your workspace");
    setProjects((all) => [
      { id: next.id, name: next.document.name },
      ...all.filter((x) => x.id !== next.id),
    ]);
    return next;
  }
  const save = () =>
    exclusive(async () => {
      setStatus("Saving images and story…");
      await persist();
    });
  useEffect(() => {
    if (!api || !project || !dirty || busy || error) return;
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
  const open = (id: string) =>
    exclusive(async () => {
      if (api) {
        const current = live.current;
        const hasInitialChanges =
          JSON.stringify(current) !== initialDraft.current ||
          current.slides.some((s) => s.origin === "upload" && !s.assetId);
        if (
          projectRef.current
            ? serialize(current.slides, current.name) !== saved.current
            : hasInitialChanges
        )
          throw new Error(
            "Save your current project before opening another one. Your edits are still here.",
          );
        setStatus("Opening project…");
        await hydrate(await api.getCarousel(id));
      }
    });
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
      const next = live.current.slides.map((s) =>
        s.id !== id
          ? s
          : {
              ...s,
              region: result.region,
              protectedRegions: result.protectedRegions,
              suggestions,
              story: suggestions[0].prompt,
              selectedStory: suggestions[0].id,
              analysisSummary: result.summary,
              reviewed: false,
            },
      );
      setSlides(next);
      await persist(next);
      setStatus("Suggestions saved. Review the words and movement area.");
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
    projects,
    project,
    busy,
    status,
    error,
    dirty,
    runStatus,
    acknowledged,
    save,
    open,
    analyze,
    acknowledge,
    generate,
    refreshProjects,
    resume,
    retry,
  };
}
