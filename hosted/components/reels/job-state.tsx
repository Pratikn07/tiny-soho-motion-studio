"use client";

import { useState } from "react";

import type { ReelJobView } from "@/lib/reels";
import type { MacState } from "@/components/shell/ShellBar";
import r from "./reels.module.css";

export const active = (job?: ReelJobView) => job?.status === "queued" || job?.status === "running";

/** Where a step's job is: waiting for the Mac, working, failed, or ready. */
export function JobState({ job, macState, onRetry }: { job?: ReelJobView; macState: MacState; onRetry: () => void }) {
  if (!job) return null;
  if (job.status === "queued") {
    return <p className={r.status} role="status">{macState === "online" ? "Queued. The Studio Mac will start it in a moment." : "Waiting for the Studio Mac. It starts as soon as your Mac is awake and online."}</p>;
  }
  if (job.status === "running") return <p className={r.status} role="status" aria-busy="true">{job.progress ?? "The Studio Mac is working on this step."}</p>;
  if (job.status === "failed") {
    return <div className={r.failed} role="alert"><p>{job.progress ?? "This step didn't finish."} ({job.errorCode ?? "error"})</p><button type="button" className={r.secondary} onClick={onRetry}>Try again</button></div>;
  }
  return null;
}

/** Copies text with the Clipboard API, falling back to a hidden text box where the browser blocks it. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.append(box);
    box.select();
    const copied = document.execCommand("copy");
    box.remove();
    return copied;
  }
}

/** A button that copies text and says so for a moment, or says it couldn't. */
export function CopyButton({ text, label = "Copy prompt" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button type="button" className={r.secondary} aria-live="polite" onClick={() => {
      void copyText(text).then((copied) => { setState(copied ? "copied" : "failed"); setTimeout(() => setState("idle"), 1800); });
    }}>{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}</button>
  );
}

/** A comment box that opens from a small link, for "change this one" requests. */
export function CommentBox({ id, label, placeholder, submit, onSend }: {
  id: string; label: string; placeholder: string; submit: string; onSend: (text: string) => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) return <button type="button" className={r.link} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div className={r.actions}>
      <label htmlFor={id} className={r.label}>{label}</label>
      <textarea id={id} className={r.field} rows={2} value={text} maxLength={1000} placeholder={placeholder} onChange={(event) => setText(event.target.value)} />
      <div className={r.buttons}>
        <button type="button" className={r.secondary} disabled={!text.trim()}
          onClick={() => { void Promise.resolve(onSend(text.trim())).then(() => { setText(""); setOpen(false); }); }}>{submit}</button>
        <button type="button" className={r.link} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
