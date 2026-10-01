"use client";
import { useEffect, useRef, useState } from "react";
import type { SlideV2, TextAnimation } from "@/lib/contract";
import type { CreationApi } from "../api";
import { scheduleText, splitTextLines, type Box } from "./lines";
import s from "./text-animation.module.css";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.crossOrigin = "anonymous";
    image.onload = () => resolve(image); image.onerror = () => reject(new Error("image")); image.src = url;
  });
}
type Layers = { background: HTMLImageElement; text: HTMLCanvasElement; boxes: Box[] };
export function TextPreview({ api, slide, animation, onRetry }: { api: CreationApi; slide: SlideV2; animation: TextAnimation; onRetry: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layers, setLayers] = useState<Layers | null>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [play, setPlay] = useState(0);
  const requestedAnimation = useRef<TextAnimation | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches); update();
    query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let disposed = false; setLayers(null); setError(false);
    if (!slide.layers.backgroundAssetId || !slide.layers.textAssetId) { setError(true); return; }
    void Promise.all([api.assetUrl(slide.layers.backgroundAssetId), api.assetUrl(slide.layers.textAssetId)]).then(async ([bg, text]) => {
      const [background, image] = await Promise.all([loadImage(bg), loadImage(text)]);
      const cleaned = document.createElement("canvas"); cleaned.width = image.naturalWidth; cleaned.height = image.naturalHeight;
      const context = cleaned.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, cleaned.width, cleaned.height);
      const { boxes, pixels } = splitTextLines(data.data, cleaned.width, cleaned.height);
      data.data.set(pixels); context.putImageData(data, 0, 0);
      if (!disposed) setLayers({ background, text: cleaned, boxes });
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [api, slide.layers.backgroundAssetId, slide.layers.textAssetId]);
  const timing = scheduleText(animation, layers?.boxes.length ?? slide.checks?.textLayer?.lines ?? 0);
  useEffect(() => {
    if (!layers || !canvas.current) return;
    const target = canvas.current; target.width = layers.text.width; target.height = layers.text.height;
    const context = target.getContext("2d"); if (!context) return;
    let frame = 0, began: number | null = null;
    const moving = animation.style !== "none" && layers.boxes.length <= 60 && (!reduced || requestedAnimation.current === animation);
    setPlaying(moving);
    const draw = (now: number) => {
      began ??= now;
      const seconds = moving ? (now - began) / 1000 : 5;
      context.globalAlpha = 1; context.clearRect(0, 0, target.width, target.height);
      context.drawImage(layers.background, 0, 0, target.width, target.height);
      layers.boxes.forEach(([left, top, right, bottom], i) => {
        const fraction = timing.fade === 0 ? 1 : Math.max(0, Math.min(1, (seconds - timing.starts[i]) / timing.fade));
        context.globalAlpha = fraction;
        context.drawImage(layers.text, left, top, right - left, bottom - top, left, top + timing.rise * (1 - fraction), right - left, bottom - top);
      });
      context.globalAlpha = 1;
      if (moving && seconds < timing.textInBy + 0.1) frame = requestAnimationFrame(draw);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [layers, animation, reduced, play]);
  return <div className={s.preview}>
    <canvas ref={canvas} role="img" aria-label="Text animation preview on the original still" style={{ aspectRatio: `${slide.width ?? 4} / ${slide.height ?? 5}` }} />
    {error ? <p role="status">The preview couldn’t load. <button onClick={onRetry}>Reload preview</button></p>
      : !layers ? <p className={s.muted}>Loading text preview…</p> : <>
        <p aria-live="polite">All text in by {timing.textInBy.toFixed(1)}s</p>
        {timing.textInBy > 3 && <p className={s.muted}>Viewers may swipe before reading the last line.</p>}
        {layers.boxes.length > 60 && <p role="alert">This layer has more than 60 lines. Simplify the text before generating.</p>}
      </>}
    <button className={s.secondary} disabled={!layers || playing || layers.boxes.length > 60} onClick={() => { requestedAnimation.current = animation; setPlay((n) => n + 1); }}>Play text preview</button>
    <p className={s.muted}>{reduced ? "Reduced motion: the complete still appears until you press play." : "Preview on the original still. No video generation needed."}</p>
  </div>;
}
