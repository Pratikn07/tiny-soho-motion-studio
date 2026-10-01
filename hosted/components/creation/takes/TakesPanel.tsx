"use client";
import { useEffect, useRef, useState } from "react";
import { creationViewSchema, runResponseSchema } from "@/lib/contract";
import type { SlidePanelProps } from "../panels";
import { downloadTake } from "../export/download";
import { ExportBar } from "../export/ExportBar";
import { CarouselPreview } from "./CarouselPreview";
import { RunProgress } from "./RunProgress";
import { TakeGrid } from "./TakeGrid";
import { isActive, useRun } from "./useRun";
import s from "./takes.module.css";

export function TakesPanel(props: SlidePanelProps) {
  return (
    <TakesForSlide
      key={`${props.creation.id}:${props.slide.id}:${props.slide.latestRunId}`}
      {...props}
    />
  );
}
function TakesForSlide({
  creation,
  slide,
  api,
  saveServerStep,
}: SlidePanelProps) {
  const { run, error, reload } = useRun(api, slide.latestRunId);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [comparison, setComparison] = useState(false);
  const mounted = useRef(true),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (comparison) dialog.current?.showModal?.();
  }, [comparison]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (mounted.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "That couldn't be done. Try again.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const choose = (takeId: string) =>
    perform(() =>
      saveServerStep(async (latest) =>
        creationViewSchema.parse(
          await api.fetchJson(
            `/api/creations/${latest.id}/slides/${slide.id}/choose`,
            { method: "POST", body: { revision: latest.revision, takeId } },
          ),
        ),
      ),
    );
  const mutate = (action: "retry" | "cancel") =>
    perform(async () => {
      if (!run) return;
      runResponseSchema.parse(
        await api.fetchJson(`/api/runs/${run.id}/${action}`, {
          method: "POST",
        }),
      );
      if (mounted.current) reload();
    });
  const download = (takeId: string, kind: "clip" | "cover") =>
    perform(async () => {
      if (run) await downloadTake(api, run.id, takeId, kind, slide.name);
    });
  const grid = run ? (
    <TakeGrid
      api={api}
      slide={slide}
      takes={run.takes}
      busy={busy}
      onChoose={choose}
      onDownload={download}
      onRefresh={reload}
    />
  ) : null;
  return (
    <div className={s.panel}>
      <h2 className={s.title}>Takes and downloads</h2>
      {!slide.latestRunId && (
        <p className={s.muted}>
          Generate this slide to compare its takes here.
        </p>
      )}
      {slide.latestRunId && !run && !error && (
        <p className={s.muted}>Loading your saved takes…</p>
      )}
      {error && (
        <p role="status">
          {error}{" "}
          <button className={s.secondary} onClick={reload}>
            Reload takes
          </button>
        </p>
      )}
      {run && (
        <>
          <RunProgress run={run} />
          <div className={s.actions}>
            {isActive(run) ? (
              <button
                className={s.secondary}
                disabled={busy}
                onClick={() => void mutate("cancel")}
              >
                Cancel
              </button>
            ) : (
              <button
                className={s.secondary}
                disabled={busy}
                onClick={() => void mutate("retry")}
              >
                Try another take
              </button>
            )}
            {run.takes.some((t) => t.finalVideoUrl) && (
              <button
                className={s.secondary}
                onClick={() => setComparison(true)}
              >
                Compare full size
              </button>
            )}
          </div>
          {!comparison && grid}
          {comparison && (
            <dialog
              ref={dialog}
              className={s.dialog}
              aria-label={`Compare takes for ${slide.name}`}
              onCancel={() => setComparison(false)}
            >
              <div className={s.dialogHead}>
                <h2 className={s.title}>{slide.name} · Compare takes</h2>
                <button
                  className={s.secondary}
                  onClick={() => {
                    dialog.current?.close();
                    setComparison(false);
                  }}
                >
                  Close comparison
                </button>
              </div>
              {grid}
            </dialog>
          )}
        </>
      )}
      {notice && (
        <p className={s.error} role="alert">
          {notice}
        </p>
      )}
      <CarouselPreview api={api} creation={creation} />
      <ExportBar api={api} slides={creation.document.slides} />
    </div>
  );
}
