import type { RunView } from "@/lib/contract";
import { money } from "../model/client";
import s from "./takes.module.css";
const labels = {
  queued: "Waiting for the GPU",
  generating: "Animating",
  finishing: "Adding your text",
  checking: "Checking",
  completed: "Ready",
  needs_attention: "Needs a look",
  failed: "Needs a look",
  canceled: "Canceled",
};
export function RunProgress({ run }: { run: RunView }) {
  return (
    <div className={s.progress} role="status" aria-live="polite">
      <strong>{labels[run.status]}</strong>
      <p>
        Take {Math.max(1, run.attemptCount)} of {run.maxAttempts} ·{" "}
        {money(run.costUsd)} so far
      </p>
      {run.reasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      {run.status === "canceled" && (
        <p>A take already running may still finish. No new take will start.</p>
      )}
    </div>
  );
}
