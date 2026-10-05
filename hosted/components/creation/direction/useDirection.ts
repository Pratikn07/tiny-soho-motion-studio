"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { directionRunViewSchema, MAX_DIRECTION_SLIDES, type DirectionRunView } from "@/lib/contract";
import { CreationApiError, type CreationApi } from "../api";

export type FinishedEntry = { slideId: string; file: File };
export type FinishedUpload = { name: string; progress: number; status: "uploading" | "done" | "error"; error?: string };
type Stored = { runIds: string[]; assets: Record<string, string> };

const CONCURRENT = 3;
const storageKey = (creationId: string) => `tiny-soho:direction:${creationId}`;
const message = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");

function readStored(creationId: string): Stored {
  try {
    const raw = window.localStorage.getItem(storageKey(creationId));
    const parsed = raw ? JSON.parse(raw) as Stored : null;
    return parsed && Array.isArray(parsed.runIds) ? parsed : { runIds: [], assets: {} };
  } catch {
    return { runIds: [], assets: {} };
  }
}
function writeStored(creationId: string, stored: Stored) {
  try {
    window.localStorage.setItem(storageKey(creationId), JSON.stringify(stored));
  } catch {
    // Remembering runs across reloads is a convenience; the run itself lives on the server.
  }
}

/**
 * Finished slides through the motion director: upload each slide as posted (words and all), start one direction
 * run per ten slides, and poll until the director has turned them into layers. `onFinished` reloads the creation.
 */
export function useDirection(options: {
  api: CreationApi;
  creationId: string | null;
  onFinished: (creationId: string) => void | Promise<void>;
  pollMs?: number;
  objectUrl?: (file: File) => string;
}) {
  const { api, creationId, onFinished } = options;
  const pollMs = options.pollMs ?? 15_000;
  const objectUrl = useRef(options.objectUrl ?? ((file: File) => URL.createObjectURL(file))).current;
  const [uploads, setUploads] = useState<Record<string, FinishedUpload>>({});
  const [runs, setRuns] = useState<DirectionRunView[]>([]);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const assets = useRef<Record<string, string>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const remember = useCallback((id: string, list: DirectionRunView[]) => {
    writeStored(id, { runIds: list.map((run) => run.id), assets: assets.current });
  }, []);

  // Pick up runs started earlier for this creation (for example before a reload). Switching between creations
  // clears the screen; the first paste creating a new creation (no id yet, then an id) must keep its uploads.
  const previousId = useRef(creationId);
  useEffect(() => {
    const switched = previousId.current !== null && previousId.current !== creationId;
    previousId.current = creationId;
    if (switched) {
      setRuns([]);
      setUploads({});
      setLocal({});
      setError("");
    }
    if (!creationId) return;
    const stored = readStored(creationId);
    assets.current = stored.assets ?? {};
    if (!stored.runIds.length) return;
    let current = true;
    void Promise.all(stored.runIds.map(async (runId) => {
      try {
        return directionRunViewSchema.parse(await api.fetchJson(`/api/creations/${creationId}/direction/${runId}`));
      } catch {
        return null;
      }
    })).then((found) => {
      if (current) setRuns(found.filter((run): run is DirectionRunView => Boolean(run)));
    });
    return () => { current = false; };
  }, [api, creationId]);

  // Poll running runs. When one finishes, reload the creation so its slides show their new layers.
  useEffect(() => {
    if (!creationId || !runs.some((run) => run.status === "running")) return;
    const timer = window.setTimeout(async () => {
      const next = await Promise.all(runsRef.current.map(async (run) => {
        if (run.status !== "running") return run;
        try {
          return directionRunViewSchema.parse(await api.fetchJson(`/api/creations/${creationId}/direction/${run.id}`));
        } catch {
          return run;
        }
      }));
      const finished = next.some((run, index) => runsRef.current[index]?.status === "running" && run.status !== "running");
      setRuns(next);
      if (finished) await finishedRef.current(creationId);
    }, pollMs);
    return () => window.clearTimeout(timer);
  }, [api, creationId, pollMs, runs]);

  const startRuns = useCallback(async (id: string, slides: Array<{ slideId: string; finishedAssetId: string }>) => {
    const started: DirectionRunView[] = [];
    for (let index = 0; index < slides.length; index += MAX_DIRECTION_SLIDES) {
      const chunk = slides.slice(index, index + MAX_DIRECTION_SLIDES);
      started.push(directionRunViewSchema.parse(await api.fetchJson(`/api/creations/${id}/direction`, {
        method: "POST",
        body: { idempotencyKey: crypto.randomUUID(), slides: chunk },
      })));
    }
    setRuns((current) => {
      const next = [...current, ...started];
      remember(id, next);
      return next;
    });
  }, [api, remember]);

  const start = useCallback(async (id: string, entries: FinishedEntry[]) => {
    setError("");
    setLocal((current) => ({ ...current, ...Object.fromEntries(entries.map((e) => [e.slideId, objectUrl(e.file)])) }));
    setUploads((current) => ({
      ...current,
      ...Object.fromEntries(entries.map((e) => [e.slideId, { name: e.file.name, progress: 0, status: "uploading" as const }])),
    }));
    const patch = (slideId: string, change: Partial<FinishedUpload>) => setUploads((current) => (
      current[slideId] ? { ...current, [slideId]: { ...current[slideId], ...change } } : current
    ));
    const queue = [...entries];
    const uploaded: Array<{ slideId: string; finishedAssetId: string }> = [];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const { slideId, file } = entry;
        try {
          const assetId = crypto.randomUUID();
          const signed = await api.requestFinishedUpload(id, slideId, {
            assetId, fileName: file.name.slice(0, 255) || "slide", size: file.size,
            mime: file.type as "image/png" | "image/jpeg" | "image/webp",
          });
          await api.uploadFile(signed.signedUrl, file, (progress) => patch(slideId, { progress }));
          await api.finaliseFinished(id, slideId, assetId);
          assets.current[slideId] = assetId;
          uploaded.push({ slideId, finishedAssetId: assetId });
          patch(slideId, { progress: 1, status: "done" });
        } catch (failure) {
          patch(slideId, { status: "error", error: message(failure) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, entries.length) }, worker));
    // Keep carousel order: workers finish in any order.
    const order = new Map(entries.map((e, index) => [e.slideId, index]));
    uploaded.sort((a, b) => (order.get(a.slideId) ?? 0) - (order.get(b.slideId) ?? 0));
    if (!uploaded.length) return;
    try {
      await startRuns(id, uploaded);
    } catch (failure) {
      setError(failure instanceof CreationApiError && failure.code === "direction_not_configured"
        ? "The motion director isn't set up yet. You can upload layers instead."
        : message(failure));
    }
  }, [api, objectUrl, startRuns]);

  /** Starts a failed or partial run again for the slides that weren't directed. */
  const retry = useCallback(async (run: DirectionRunView) => {
    if (!creationId) return;
    const slides = run.slides
      .filter((slide) => slide.status !== "completed" && assets.current[slide.slideId])
      .map((slide) => ({ slideId: slide.slideId, finishedAssetId: assets.current[slide.slideId] }));
    if (!slides.length) return;
    setError("");
    try {
      await startRuns(creationId, slides);
    } catch (failure) {
      setError(message(failure));
    }
  }, [creationId, startRuns]);

  const dismiss = useCallback((runId: string) => {
    setRuns((current) => {
      const next = current.filter((run) => run.id !== runId);
      if (creationId) remember(creationId, next);
      return next;
    });
  }, [creationId, remember]);

  return { uploads, runs, local, error, start, retry, dismiss };
}
