"use client";

import { useEffect, useState } from "react";

import type { DirectionRunView } from "@/lib/contract";
import type { FinishedUpload } from "./useDirection";
import d from "./direction.module.css";

const ERRORS: Record<string, string> = {
  direction_timeout: "The director didn't report back within two hours.",
  result_invalid: "The director's result couldn't be read.",
  direction_failed: "None of the slides could be directed.",
  routine_unavailable: "The director couldn't be started.",
  routine_busy: "The director is busy. Try again in a little while.",
  outputs_missing: "The director didn't return this slide.",
  outputs_invalid: "This slide's layers came back damaged.",
  outputs_size_mismatch: "This slide's layers came back at different sizes.",
};
const explain = (code: string | null | undefined) => (code ? ERRORS[code] ?? "Something went wrong." : "");

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return <>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</>;
}

/** Progress of finished slides through the motion director, then its preview clips. */
export function DirectionStatus({ uploads, runs, error, names, onRetry, onDismiss }: {
  uploads: Record<string, FinishedUpload>;
  runs: DirectionRunView[];
  error: string;
  names: Record<string, string>;
  onRetry: (run: DirectionRunView) => void;
  onDismiss: (runId: string) => void;
}) {
  const uploading = Object.values(uploads).filter((upload) => upload.status === "uploading");
  const failedUploads = Object.entries(uploads).filter(([, upload]) => upload.status === "error");
  if (!uploading.length && !failedUploads.length && !runs.length && !error) return null;
  return (
    <section className={d.panel} aria-label="Motion director">
      {uploading.length > 0 && (
        <p className={d.line} role="status">
          Uploading {uploading.length} {uploading.length === 1 ? "slide" : "slides"} for the director…
        </p>
      )}
      {failedUploads.map(([slideId, upload]) => (
        <p key={slideId} className={d.problem} role="alert">{names[slideId] ?? upload.name}: {upload.error}</p>
      ))}
      {error && <p className={d.problem} role="alert">{error}</p>}
      {runs.map((run) => {
        const done = run.slides.filter((slide) => slide.status === "completed");
        return (
          <div key={run.id} className={d.run}>
            {run.status === "running" ? (
              <p className={d.line} role="status">
                <span className={d.pulse} aria-hidden="true" />
                Directing {run.slides.length} {run.slides.length === 1 ? "slide" : "slides"} · <Elapsed since={run.createdAt} /> ·
                usually 2–4 minutes a slide
                {run.sessionUrl && <> · <a href={run.sessionUrl} target="_blank" rel="noopener noreferrer">Watch the director</a></>}
              </p>
            ) : (
              <p className={d.line} role="status">
                {run.status === "failed"
                  ? <>The director couldn&rsquo;t finish. {explain(run.errorCode)}</>
                  : <>Directed {done.length} of {run.slides.length} {run.slides.length === 1 ? "slide" : "slides"}. Their layers are ready.</>}
                {run.status !== "completed" && <button className={d.linkButton} onClick={() => onRetry(run)}>Try the rest again</button>}
                <button className={d.linkButton} onClick={() => onDismiss(run.id)}>Hide</button>
              </p>
            )}
            {done.some((slide) => slide.previewUrl) && (
              <ul className={d.previews} aria-label="Director previews">
                {done.filter((slide) => slide.previewUrl).map((slide) => (
                  <li key={slide.slideId}>
                    <video src={slide.previewUrl} muted loop playsInline controls preload="metadata"
                      aria-label={`Preview of ${names[slide.slideId] ?? "slide"}`} />
                    <span>{names[slide.slideId] ?? "Slide"}{slide.concept ? ` · ${slide.concept}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {run.slides.filter((slide) => slide.status === "failed").map((slide) => (
              <p key={slide.slideId} className={d.problem}>{names[slide.slideId] ?? "Slide"}: {explain(slide.error)}</p>
            ))}
          </div>
        );
      })}
    </section>
  );
}
