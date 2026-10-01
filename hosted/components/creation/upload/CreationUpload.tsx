"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type DragEvent } from "react";

import Icon from "@/components/carousel/Icons";
import u from "./upload.module.css";

export type FilePickerHandle = { open: () => void };

type Props = { onFiles: (files: File[]) => void; variant: "hero" | "compact"; disabled?: boolean };

const ACCEPT = "image/png,image/jpeg,image/webp";

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/** Drop zone and file picker for slide layers. Many files at once; they pair themselves by name. */
export const CreationUpload = forwardRef<FilePickerHandle, Props>(function CreationUpload({ onFiles, variant, disabled }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }), []);
  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      aria-hidden="true"
      tabIndex={-1}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length) onFiles(files);
      }}
    />
  );
  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length && !disabled) onFiles(files);
    },
  };
  if (variant === "compact") {
    return (
      <div className={`${u.addZone} ${over ? u.dropActive : ""}`} {...dropProps}>
        {picker}
        <button className={u.addButton} onClick={() => input.current?.click()} disabled={disabled}>
          <Icon name="plus" size={16} /> Add slides
        </button>
      </div>
    );
  }
  return (
    <section className={`${u.hero} ${over ? u.dropActive : ""}`} aria-labelledby="upload-heading" {...dropProps}>
      {picker}
      <p className={u.eyebrow}>NEW CREATION</p>
      <h1 id="upload-heading" tabIndex={-1}>Bring your slides in <em>as layers.</em></h1>
      <p className={u.heroIntro}>
        For each slide, drop two files from the same design: the picture without any words, and the words on a
        transparent PNG. Your lettering is never redrawn; only the picture moves.
      </p>
      <div className={u.dropCard}>
        <span className={u.dropIcon}><Icon name="upload" size={23} /></span>
        <div>
          <h2>Drop the whole carousel here</h2>
          <p>
            Name each pair alike, such as <code>potty-background.jpg</code> and <code>potty-text.png</code>
            (also <code>-bg</code> / <code>-txt</code>). Up to 20 slides; PNG, JPG or WebP.
          </p>
        </div>
        <button onClick={() => input.current?.click()} disabled={disabled}>
          Choose files <Icon name="arrow" size={15} />
        </button>
      </div>
    </section>
  );
});
