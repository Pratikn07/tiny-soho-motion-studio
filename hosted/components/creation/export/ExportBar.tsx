"use client";
import { createPortal } from "react-dom";
import { useState } from "react";
import type { SlideV2 } from "@/lib/contract";
import type { CreationApi } from "../api";
import { downloadChosen } from "./download";
import s from "../takes/takes.module.css";
export function ExportBar({
  api,
  slides,
  actionHost,
}: {
  api: CreationApi;
  slides: SlideV2[];
  actionHost?: HTMLElement | null;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const count = slides.filter((slide) => slide.chosenTakeId).length;
  const controls = (
    <div className={s.export}>
      <p className={s.muted}>
        {count} of {slides.length} slides have a chosen take.
      </p>
      <button
        className={s.primary}
        disabled={busy || !count}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await downloadChosen(api, slides);
            setMessage(
              "Chosen clips downloaded in slide order. Allow multiple downloads if your browser asks.",
            );
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "The clips couldn't be downloaded. Try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Downloading chosen clips…"
          : `Download all chosen clips${count ? ` (${count})` : ""}`}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
  return actionHost ? createPortal(controls, actionHost) : controls;
}
