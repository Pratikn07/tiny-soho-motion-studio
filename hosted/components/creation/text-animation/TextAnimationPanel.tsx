"use client";
import { useEffect, useState } from "react";
import { DEFAULT_TEXT_ANIMATION, type SlideV2, type TextAnimation } from "@/lib/contract";
import type { CreationApi } from "../api";
import type { SlidePanelProps } from "../panels";
import { TextPreview } from "./TextPreview";
import s from "./text-animation.module.css";

export const TEXT_SPEEDS = { gentle: { step: 0.18, fade: 0.5 }, normal: { step: 0.14, fade: 0.35 }, quick: { step: 0.08, fade: 0.22 } };
export function TextAnimationPanel({ creation, slide, api, edit, editSlide }: SlidePanelProps) {
  const [retry, setRetry] = useState(0);
  const overriding = slide.textAnimation !== undefined;
  const animation = slide.textAnimation ?? creation.document.defaults.textAnimation ?? DEFAULT_TEXT_ANIMATION;
  const speed = Object.entries(TEXT_SPEEDS).find(([, value]) => value.step === animation.step && value.fade === animation.fade)?.[0] ?? "custom";
  const update = (change: Partial<TextAnimation>) => overriding
    ? editSlide((item) => ({ ...item, textAnimation: { ...(item.textAnimation ?? creation.document.defaults.textAnimation), ...change } }))
    : edit((doc) => ({ ...doc, defaults: { ...doc.defaults, textAnimation: { ...doc.defaults.textAnimation, ...change } } }));
  const cover = <label className={s.field}>Cover image<select value={animation.coverFrame} onChange={(e) => update({ coverFrame: e.target.value as "first" | "last" })}>
      <option value="last">Full text on last frame (recommended)</option><option value="first">First frame</option>
    </select></label>;
  if (slide.direction) return <div className={s.panel}>
    <h2 className={s.title}>Text animation</h2>
    <p className={s.muted}>Designed by the motion director for this slide. Every final video plays this motion over the
      generated clip, then holds the text exactly as designed.</p>
    {slide.direction.previewAssetId
      ? <DirectorPreview api={api} slide={slide} assetId={slide.direction.previewAssetId} />
      : <p className={s.muted}>The director&rsquo;s preview isn&rsquo;t available for this slide.</p>}
    {cover}
    <p className={s.muted}>To use a simple line-by-line reveal instead, upload this slide&rsquo;s layers again.</p>
  </div>;
  return <div className={s.panel}>
    <h2 className={s.title}>Text animation</h2>
    <p className={s.muted}>{overriding ? "Only for this slide." : "Creation default. Slides with custom settings keep theirs."}</p>
    <label className={s.field}>Text style<select value={animation.style} onChange={(e) => update({ style: e.target.value as TextAnimation["style"] })}>
      <option value="none">None</option><option value="fade">Fade</option><option value="fade-rise">Fade and rise</option><option value="soft-zoom">Soft zoom</option><option value="slide-in">Slide in</option>
    </select></label>
    <label className={s.field}>Text speed<select value={speed} disabled={animation.style === "none"}
      onChange={(e) => update(TEXT_SPEEDS[e.target.value as keyof typeof TEXT_SPEEDS])}>
      {speed === "custom" && <option value="custom">Custom timing</option>}
      <option value="gentle">Gentle</option><option value="normal">Normal</option><option value="quick">Quick</option>
    </select></label>
    {cover}
    <label className={s.override}><input type="checkbox" checked={overriding} onChange={(e) => editSlide((item) => {
      const { textAnimation: previous, ...rest } = item;
      return e.target.checked ? { ...rest, textAnimation: { ...animation } } : rest;
    })} />Use different text settings for this slide</label>
    <button className={s.secondary} onClick={() => overriding
      ? editSlide(item => { const { textAnimation: _previous, ...rest } = item; return rest; })
      : edit(doc => ({ ...doc, defaults: { ...doc.defaults, textAnimation: { ...DEFAULT_TEXT_ANIMATION } } }))}>
      {overriding ? "Use creation text settings" : "Reset text settings"}
    </button>
    <p className={s.muted}>Changes apply to future videos. Generate again to update an existing take.</p>
    {slide.layers.textAssetId ? <TextPreview key={`${slide.id}-${retry}`} api={api} slide={slide} animation={animation} onRetry={() => setRetry((n) => n + 1)} />
      : <p className={s.muted}>Add a transparent text layer to preview its animation.</p>}
  </div>;
}

/** The director's own preview: its text motion over the still, text-free photo. */
function DirectorPreview({ api, slide, assetId }: { api: CreationApi; slide: SlideV2; assetId: string }) {
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    api.assetUrl(assetId).then((next) => { if (live) setUrl(next); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, assetId]);
  if (failed) return <p className={s.muted}>The director&rsquo;s preview couldn&rsquo;t be loaded. Reopen this tab to try again.</p>;
  if (!url) return <p className={s.muted}>Loading the director&rsquo;s preview…</p>;
  return <div className={s.preview}>
    <video src={url} style={{ aspectRatio: `${slide.width ?? 4} / ${slide.height ?? 5}`, width: "100%" }}
      muted loop playsInline autoPlay controls aria-label="The director's text animation" />
  </div>;
}
