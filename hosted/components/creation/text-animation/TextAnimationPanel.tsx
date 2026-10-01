"use client";
import { useState } from "react";
import { DEFAULT_TEXT_ANIMATION, type TextAnimation } from "@/lib/contract";
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
  return <div className={s.panel}>
    <h2 className={s.title}>Text animation</h2>
    <p className={s.muted}>{overriding ? "Only for this slide." : "For every slide in this creation."}</p>
    <label className={s.field}>Text style<select value={animation.style} onChange={(e) => update({ style: e.target.value as TextAnimation["style"] })}>
      <option value="none">None</option><option value="fade">Fade</option><option value="fade-rise">Fade and rise</option>
    </select></label>
    <label className={s.field}>Text speed<select value={speed} disabled={animation.style === "none"}
      onChange={(e) => update(TEXT_SPEEDS[e.target.value as keyof typeof TEXT_SPEEDS])}>
      {speed === "custom" && <option value="custom">Custom timing</option>}
      <option value="gentle">Gentle</option><option value="normal">Normal</option><option value="quick">Quick</option>
    </select></label>
    <label className={s.field}>Cover image<select value={animation.coverFrame} onChange={(e) => update({ coverFrame: e.target.value as "first" | "last" })}>
      <option value="last">Full text on last frame (recommended)</option><option value="first">First frame</option>
    </select></label>
    <label className={s.override}><input type="checkbox" checked={overriding} onChange={(e) => editSlide((item) => {
      const { textAnimation: previous, ...rest } = item;
      return e.target.checked ? { ...rest, textAnimation: { ...animation } } : rest;
    })} />Use different text settings for this slide</label>
    {slide.layers.textAssetId ? <TextPreview key={`${slide.id}-${retry}`} api={api} slide={slide} animation={animation} onRetry={() => setRetry((n) => n + 1)} />
      : <p className={s.muted}>Add a transparent text layer to preview its animation.</p>}
  </div>;
}
