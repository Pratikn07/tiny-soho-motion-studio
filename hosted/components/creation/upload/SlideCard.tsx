"use client";

import { useState, type KeyboardEvent } from "react";

import type { SlideV2 } from "@/lib/contract";
import Icon from "@/components/carousel/Icons";
import { ratioLabel } from "./pairing";
import type { FileUpload, SlideUpload } from "./useUploads";
import u from "./upload.module.css";

export type SlideStatus = "uploading" | "checking" | "error" | "ready" | "blocked" | "missing" | "directing";

/**
 * Where a slide stands, from its live upload (this session) or its saved checks (after a reload). A finished slide
 * the motion director is still working on has no layers yet, and is "directing" rather than missing files.
 */
export function slideStatus(slide: SlideV2, upload?: SlideUpload, directing = false): SlideStatus {
  if (upload?.phase === "uploading") return "uploading";
  if (upload?.phase === "checking") return "checking";
  if (upload?.phase === "error") return "error";
  if (directing && !slide.layers.backgroundAssetId) return "directing";
  const checks = upload?.checks ?? slide.checks;
  if (!slide.layers.backgroundAssetId || !checks) return "missing";
  return checks.ok ? "ready" : "blocked";
}

const progressOf = (files: Array<FileUpload | null>) => {
  const list = files.filter((file): file is FileUpload => Boolean(file));
  return list.length ? Math.round((list.reduce((sum, file) => sum + file.progress, 0) / list.length) * 100) : 0;
};

export function statusText(status: SlideStatus, upload?: SlideUpload) {
  switch (status) {
    case "uploading": return `Uploading ${progressOf([upload?.files.background ?? null, upload?.files.text ?? null])}%`;
    case "checking": return "Checking layers…";
    case "error": return "Upload stopped";
    case "ready": return "Ready";
    case "blocked": return "Needs a fix";
    case "missing": return "Files missing";
    case "directing": return "With the director";
  }
}

type Props = {
  slide: SlideV2;
  position: number;
  total: number;
  selected: boolean;
  upload?: SlideUpload;
  /** The motion director is working on this finished slide. */
  directing?: boolean;
  preview: { background: string | null; text: string | null };
  onSelect: () => void;
  onMove: (to: number) => void;
  onRetry: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
};

export function SlideCard(props: Props) {
  const { slide, position, total, selected, upload, preview } = props;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const status = slideStatus(slide, upload, props.directing);
  const size = slide.width && slide.height ? { width: slide.width, height: slide.height } : natural;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (position > 0) props.onMove(position - 1);
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      if (position < total - 1) props.onMove(position + 1);
    }
  };
  const files = upload ? [upload.files.background, upload.files.text].filter((file): file is FileUpload => Boolean(file)) : [];
  return (
    <li
      className={`${u.card} ${selected ? u.cardSelected : ""} ${props.dragging ? u.cardDragging : ""} ${u[`status_${status}`] ?? ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", slide.id);
        props.onDragStart();
      }}
      onDragEnter={props.onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={props.onDragEnd}
      onDrop={(event) => event.preventDefault()}
    >
      <button
        className={u.cardSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={`Slide ${position + 1}: ${slide.name}, ${statusText(status, upload)}`}
        aria-describedby="slide-reorder-hint"
        onClick={props.onSelect}
        onKeyDown={onKeyDown}
      >
        <span className={u.cardNumber}>{String(position + 1).padStart(2, "0")}</span>
        <span className={u.well} style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}>
          {preview.background ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.background} alt="" onLoad={(event) => setNatural({
                width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight,
              })} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview.text && <img className={u.textLayer} src={preview.text} alt="" />}
            </>
          ) : <span className={u.wellEmpty}><Icon name="image" size={18} /></span>}
        </span>
        <span className={u.cardBody}>
          <strong>{slide.name}</strong>
          <span className={u.cardMeta}>
            {size ? <span className={u.ratio}>{ratioLabel(size.width, size.height)}</span> : null}
            <span className={u.cardStatus}>
              {status === "ready" && <Icon name="check" size={12} />}
              {(status === "blocked" || status === "error") && <Icon name="alert" size={12} />}
              {statusText(status, upload)}
            </span>
          </span>
        </span>
      </button>
      {files.length > 0 && upload?.phase !== "done" && (
        <ul className={u.fileList} aria-label={`Files for ${slide.name}`}>
          {files.map((file, index) => (
            <li key={file.name} className={file.status === "error" ? u.fileError : undefined}>
              <span className={u.fileRole}>{index === 0 ? "Background" : "Text"}</span>
              <span className={u.fileName} title={file.name}>{file.name}</span>
              <progress max={1} value={file.progress} aria-label={`${file.name} upload`} />
            </li>
          ))}
        </ul>
      )}
      {status === "error" && (
        <div className={u.cardError}>
          <p>{upload?.error}</p>
          <button onClick={props.onRetry}>Try again</button>
        </div>
      )}
    </li>
  );
}
