"use client";
import { useEffect, useState } from "react";
import {
  ACTIVE_PIPELINE_RUN_STATUSES,
  runResponseSchema,
  type RunView,
} from "@/lib/contract";
import type { CreationApi } from "../api";
export const isActive = (run: RunView) =>
  (ACTIVE_PIPELINE_RUN_STATUSES as readonly string[]).includes(run.status);
export async function fetchRun(api: CreationApi, id: string): Promise<RunView> {
  const run = runResponseSchema.parse(
    await api.fetchJson(`/api/runs/${id}`),
  ).run;
  if (run.id !== id) throw new Error("The run couldn't be loaded. Try again.");
  return run;
}
export function useRun(api: CreationApi, id: string | null | undefined) {
  const [run, setRun] = useState<RunView | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let disposed = false,
      loading = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null);
    setError("");
    if (!id) return;
    const load = async () => {
      if (disposed || loading || document.visibilityState === "hidden") return;
      loading = true;
      clearTimeout(timer);
      try {
        const next = await fetchRun(api, id);
        if (disposed) return;
        setRun((previous) => {
          if (previous?.id !== next.id) return next;
          return {
            ...next,
            takes: next.takes.map((take) => {
              const old = previous.takes.find((item) => item.id === take.id);
              if (
                !old?.urlsExpireAt ||
                Date.parse(old.urlsExpireAt) < Date.now() + 60000
              )
                return take;
              const sameResource = (a: string | null, b: string | null) =>
                a && b
                  ? new URL(a).origin === new URL(b).origin &&
                    new URL(a).pathname === new URL(b).pathname
                  : a === b;
              if (
                !sameResource(old.rawVideoUrl, take.rawVideoUrl) ||
                !sameResource(old.finalVideoUrl, take.finalVideoUrl) ||
                !sameResource(old.coverUrl, take.coverUrl)
              )
                return take;
              return {
                ...take,
                rawVideoUrl: old.rawVideoUrl,
                finalVideoUrl: old.finalVideoUrl,
                coverUrl: old.coverUrl,
                urlsExpireAt: old.urlsExpireAt,
              };
            }),
          };
        });
        setError("");
        if (isActive(next)) timer = setTimeout(() => void load(), 4000);
      } catch {
        if (disposed) return;
        setError(
          "The takes couldn't be loaded. Your work is saved; try again.",
        );
        timer = setTimeout(() => void load(), 4000);
      } finally {
        loading = false;
      }
    };
    const focus = () => void load();
    const visibility = () => {
      if (document.visibilityState === "hidden") clearTimeout(timer);
      else void load();
    };
    void load();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [api, id, version]);
  return {
    run: run?.id === id ? run : null,
    error,
    reload: () => setVersion((n) => n + 1),
  };
}
