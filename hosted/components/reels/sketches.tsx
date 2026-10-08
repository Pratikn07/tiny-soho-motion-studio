"use client";

import { useEffect, useState } from "react";

import type { ReelScene, ScriptLine } from "@/lib/reels";
import r from "./reels.module.css";

/** A sketch is shown as an image, so nothing inside the SVG can run. */
const sketchSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The spoken words of a line, without voice cues like [curious] or a leading [0:03]. */
export const spoken = (line: string) => line.replace(/\[[^\]]*\]\s*/g, "").trim();

function seconds(time?: string) {
  const match = time?.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Each scene's start and length in seconds, from the script's times; scenes without a time get 3 s. */
export function sceneTimings(scenes: ReelScene[], lines: ScriptLine[]) {
  const starts = scenes.map((scene) => seconds(lines[scene.n - 1]?.time));
  return scenes.map((scene, index) => {
    const start = starts[index];
    const next = starts.slice(index + 1).find((value) => value !== null);
    const length = start !== null && next != null && next > start ? next - start : 3;
    return { n: scene.n, start, length: Math.min(Math.max(length, 1.5), 8) };
  });
}

const clock = (value: number | null) => (value === null ? "" : `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`);

export function SketchFrame({ scene, drawing, onOpen, size = "small" }: {
  scene: ReelScene; drawing: boolean; onOpen?: () => void; size?: "small" | "large";
}) {
  const className = `${r.frame} ${size === "large" ? r.frameLarge : ""}`;
  if (!scene.sketch) {
    return <div className={`${className} ${r.frameEmpty}`} aria-label={`Scene ${scene.n} sketch`}>{drawing ? "Drawing…" : "No sketch yet"}</div>;
  }
  const image = <img className={r.frameImage} src={sketchSrc(scene.sketch)} alt={`Sketch of scene ${scene.n}: ${spoken(scene.line)}`} />;
  return onOpen
    ? <button type="button" className={`${className} ${r.frameButton}`} onClick={onOpen} aria-label={`Play from scene ${scene.n}`}>{image}</button>
    : <div className={className}>{image}</div>;
}

/** All frames on one sheet: number, time, sketch and line, like a printed storyboard. */
export function StoryboardSheet({ scenes, lines, drawing, onOpen }: {
  scenes: ReelScene[]; lines: ScriptLine[]; drawing: boolean; onOpen: (index: number) => void;
}) {
  const timings = sceneTimings(scenes, lines);
  return (
    <ol className={r.sheet} aria-label="Storyboard sheet">
      {scenes.map((scene, index) => {
        const { start, length } = timings[index];
        return (
          <li key={scene.n} className={r.sheetFrame}>
            <p className={r.sheetHead}><span className={r.stepNo}>{String(scene.n).padStart(2, "0")}</span>
              <span className={r.time}>{start === null ? "" : `${clock(start)}–${clock(start + length)}`}</span></p>
            <SketchFrame scene={scene} drawing={drawing} onOpen={() => onOpen(index)} />
            <p className={r.sheetLine}>{spoken(scene.line)}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** A silent animatic: the sketches in order, each held for its scene's length, with the spoken line under it. */
export function Animatic({ scenes, lines, start, onClose }: { scenes: ReelScene[]; lines: ScriptLine[]; start: number; onClose: () => void }) {
  const timings = sceneTimings(scenes, lines);
  const [index, setIndex] = useState(start);
  const [playing, setPlaying] = useState(true);
  const scene = scenes[index];
  // A number, not the timings array: the reel refreshes while jobs run, and that must not restart the frame.
  const holdMs = timings[index].length * 1000;

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (index < scenes.length - 1) setIndex(index + 1); else setPlaying(false);
    }, holdMs);
    return () => clearTimeout(timer);
  }, [index, playing, scenes.length, holdMs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") { setPlaying(false); setIndex((value) => Math.min(value + 1, scenes.length - 1)); }
      if (event.key === "ArrowLeft") { setPlaying(false); setIndex((value) => Math.max(value - 1, 0)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, scenes.length]);

  return (
    <div className={r.player} role="dialog" aria-modal="true" aria-label="Storyboard preview">
      <div className={r.playerInner}>
        <SketchFrame scene={scene} drawing={false} size="large" />
        <p className={r.playerLine}><span className={r.stepNo}>{String(scene.n).padStart(2, "0")}</span> {spoken(scene.line)}</p>
        <div className={r.playerDots} aria-hidden="true">
          {scenes.map((item, dot) => <span key={item.n} className={dot === index ? r.dotOn : r.dot} />)}
        </div>
        <div className={r.buttons}>
          <button type="button" className={r.secondary} disabled={index === 0} onClick={() => { setPlaying(false); setIndex(index - 1); }}>Previous</button>
          <button type="button" className={r.primary} onClick={() => {
            if (!playing && index === scenes.length - 1) setIndex(0);
            setPlaying(!playing);
          }}>{playing ? "Pause" : index === scenes.length - 1 ? "Play again" : "Play"}</button>
          <button type="button" className={r.secondary} disabled={index === scenes.length - 1} onClick={() => { setPlaying(false); setIndex(index + 1); }}>Next</button>
          <button type="button" className={r.link} onClick={onClose}>Close</button>
        </div>
        <p className={r.muted}>A silent sketch preview. Each frame holds for its scene's length in the script.</p>
      </div>
    </div>
  );
}
