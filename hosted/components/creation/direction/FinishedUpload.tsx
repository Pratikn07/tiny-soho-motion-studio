"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import Icon from "@/components/carousel/Icons";
import u from "../upload/upload.module.css";
import d from "./direction.module.css";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
export const imageFiles = (files: File[]) => files.filter((file) => ACCEPT.includes(file.type));

/**
 * The empty creation for finished slides: drop, choose or paste the slides exactly as they'd be posted. The motion
 * director separates the words from the picture, so the creator never prepares layers.
 */
export function FinishedUpload({ onFiles, onUseLayers, disabled }: {
  onFiles: (files: File[]) => void;
  onUseLayers: () => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const latest = useRef(onFiles);
  latest.current = onFiles;

  // Paste from the clipboard (⌘V / Ctrl+V) anywhere on the page while this screen is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (disabled) return;
      const pasted = imageFiles(Array.from(event.clipboardData?.files ?? []));
      if (!pasted.length) return;
      event.preventDefault();
      latest.current(pasted);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled]);

  return (
    <section
      className={`${u.hero} ${over ? u.dropActive : ""}`}
      aria-labelledby="finished-heading"
      onDragOver={(event) => { if (hasFiles(event)) { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const files = imageFiles(Array.from(event.dataTransfer.files));
        if (files.length && !disabled) onFiles(files);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(",")}
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = imageFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <p className={u.eyebrow}>NEW CREATION</p>
      <h1 id="finished-heading" tabIndex={-1}>Paste your slides <em>as you&rsquo;d post them.</em></h1>
      <p className={u.heroIntro}>
        Words and all. The motion director lifts your words off the picture, sets them back in your brand type with
        motion that fits what they say, checks every frame, and hands each slide back ready for video.
      </p>
      <div className={u.dropCard}>
        <span className={u.dropIcon}><Icon name="upload" size={23} /></span>
        <div>
          <h2>Drop, choose or paste the carousel</h2>
          <p>Up to 20 slides; PNG, JPG or WebP. You can paste with <kbd className={d.kbd}>⌘V</kbd> too.</p>
        </div>
        <button onClick={() => input.current?.click()} disabled={disabled}>
          Choose slides <Icon name="arrow" size={15} />
        </button>
      </div>
      <p className={d.altPath}>
        Already have the picture and the words as separate files?{" "}
        <button className={d.linkButton} onClick={onUseLayers}>Upload layers instead</button>
      </p>
    </section>
  );
}
