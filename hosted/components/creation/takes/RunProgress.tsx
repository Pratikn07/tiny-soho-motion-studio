"use client";

import { useEffect, useRef, useState } from "react";
import type { RunView, TakeView } from "@/lib/contract";
import { money } from "../model/client";
import s from "./takes.module.css";
const labels = {
  queued: "Waiting to start",
  generating: "Animating",
  finishing: "Adding your text",
  checking: "Checking",
  completed: "Ready",
  needs_attention: "Needs a look",
  failed: "Needs a look",
  canceled: "Canceled",
};
const stages = [
  { id: "generating", label: "Animate" },
  { id: "finishing", label: "Add text" },
  { id: "checking", label: "Check" },
] as const;
const takeLabels = {
  generating: "Animating",
  finishing: "Adding text",
  checking: "Checking",
  done: "Ready",
  failed: "Failed",
};

function elapsed(run: RunView, active: boolean) {
  const end = active ? Date.now() : Date.parse(run.updatedAt);
  const seconds = Math.max(0, Math.floor((end - Date.parse(run.createdAt)) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Each track follows its own take. A retry must never reset a finished take's progress. */
export function RunProgress({ run }: { run: RunView }) {
  const active = ["queued", "generating", "finishing", "checking"].includes(run.status);
  const interrupted = ["canceled", "failed", "needs_attention"].includes(run.status);
  const root = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    let inView = true;
    const update = () => setAnimate(active && inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    if (root.current) observer?.observe(root.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [active]);
  const finished = run.takes.filter((take) => take.stage === "done").length;
  const ready = run.takes.filter((take) => take.stage === "done" && take.verdict === "accepted").length;
  // maxAttempts is a retry limit, not the number of takes promised to the creator.
  const count = Math.max(run.seedsPlanned.length, run.attemptCount, ...run.takes.map((take) => take.attempt));
  const takes = new Map(run.takes.map((take) => [take.attempt, take]));
  const statusFor = (take: TakeView | undefined) => {
    if (!take) return interrupted || !active ? "Not started" : "Waiting";
    if (take.stage === "done" && take.verdict !== "accepted") return "Needs a look";
    if (interrupted && take.stage !== "done" && take.stage !== "failed") return `Last reported: ${takeLabels[take.stage]}`;
    return takeLabels[take.stage];
  };
  return (
    <div ref={root} className={s.progress} data-active={animate} data-attention={interrupted} aria-label="Generation progress">
      <div className={s.progressHeading} role="status" aria-live="polite" aria-atomic="true">
        <strong>{labels[run.status]}</strong>
        <span>{finished} of {count} takes processed{ready > 0 ? ` · ${ready} ready` : ""}</span>
      </div>
      <ol className={s.takeProgress} aria-label="Take progress">
        {Array.from({ length: count }, (_, index) => {
          const attempt = index + 1;
          const take = takes.get(attempt);
          const current = stages.findIndex((stage) => stage.id === take?.stage);
          const needsLook = take?.stage === "failed" || (take?.stage === "done" && take.verdict !== "accepted");
          return (
            <li key={attempt} className={s.takeTrack} data-attention={needsLook}>
              <div className={s.takeHeading}>
                <span>Take {attempt}{attempt > run.seedsPlanned.length ? " · Extra take" : ""}</span>
                <span>{statusFor(take)}</span>
              </div>
              <ol className={s.stageTrack} aria-label={`Take ${attempt} stages`}>
                {stages.map((stage, step) => {
                  const done = take?.stage === "done" || current > step;
                  const isCurrent = active && current === step;
                  return (
                    <li key={stage.id} data-state={done ? "done" : current === step ? "current" : "waiting"} aria-current={isCurrent ? "step" : undefined}>
                      <span className={s.stageLine} aria-hidden="true" />
                      <span>{stage.label}</span>
                      <span className={s.srOnly}> — {done ? "complete" : isCurrent ? "in progress" : interrupted && current === step ? "last reported stage" : "pending"}</span>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
      <div className={s.progressMeta}>
        <span>{active ? "Elapsed" : "Duration"}: {elapsed(run, active)}</span>
        <span>{money(run.costUsd)} so far</span>
      </div>
      {active && <p className={s.progressHint}>Your run is saved. You can leave and come back.</p>}
      {run.reasons.map((reason) => <p className={s.progressReason} key={reason}>{reason}</p>)}
      {run.status === "canceled" && <p className={s.progressReason}>A take already running may still finish. No new take will start.</p>}
    </div>
  );
}
