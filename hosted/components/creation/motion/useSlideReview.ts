"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ReviewRunView, SlideReview, SlideV2 } from "@/lib/contract";
import type { CreationApi } from "../api";
import { CreationApiError } from "../api";
import { reviewClient } from "./client";

export type ReviewState =
  | { status: "waiting" }
  | { status: "loading" }
  | { status: "ready"; review: SlideReview; runId: string }
  | { status: "failed"; message: string };

const cache = new Map<string, ReviewRunView>(); // Completed review runs never change.
const UNAVAILABLE = "Suggestions aren't available right now. You can still describe your own motion.";

/**
 * The AI review for one slide. A slide with a saved `reviewRunId` loads that run; a ready slide without one starts a
 * review once (P1 reuses a finished review when nothing changed) and records the run on the slide.
 */
export function useSlideReview(options: {
  api: CreationApi;
  creationId: string;
  slide: SlideV2;
  ready: boolean;
  recordRun: (reviewRunId: string) => void;
}) {
  const { api, creationId, slide, ready, recordRun } = options;
  const client = useMemo(() => reviewClient(api), [api]);
  const [state, setState] = useState<ReviewState>({ status: "waiting" });
  const started = useRef(new Set<string>());
  const layersKey = `${slide.id}:${slide.layers.backgroundAssetId}:${slide.layers.textAssetId}`;

  const show = useCallback((run: ReviewRunView) => {
    if (run.status === "completed" && run.result) {
      cache.set(run.id, run);
      setState({ status: "ready", review: run.result, runId: run.id });
      return true;
    }
    if (run.status === "failed") setState({ status: "failed", message: UNAVAILABLE });
    return false;
  }, []);

  const start = useCallback(async (force = false) => {
    setState({ status: "loading" });
    try {
      const run = await client.start(creationId, slide.id, force);
      if (show(run)) recordRun(run.id);
    } catch (error) {
      const message = error instanceof CreationApiError && error.code !== "review_unavailable" && error.status < 500
        ? error.message
        : UNAVAILABLE;
      setState({ status: "failed", message });
    }
  }, [client, creationId, recordRun, show, slide.id]);

  useEffect(() => {
    let current = true;
    if (!ready) {
      setState({ status: "waiting" });
      return;
    }
    if (slide.reviewRunId) {
      const known = cache.get(slide.reviewRunId);
      if (known) {
        show(known);
        return;
      }
      setState({ status: "loading" });
      void client.get(slide.reviewRunId).then((run) => {
        if (current && !show(run)) setState({ status: "failed", message: UNAVAILABLE });
      }).catch(() => {
        if (current) setState({ status: "failed", message: UNAVAILABLE });
      });
      return () => { current = false; };
    }
    if (started.current.has(layersKey)) return;
    started.current.add(layersKey);
    void start();
    return () => { current = false; };
    // `start` changes with the slide; the layers key and saved run id decide when to (re)load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, slide.reviewRunId, layersKey]);

  return { state, retry: () => start(true) };
}
