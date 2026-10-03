"use client";

import { useCallback, useEffect, useState } from "react";

import type { MotionStyle as Style, SlideMotion } from "@/lib/contract";
import Icon from "@/components/carousel/Icons";
import type { SlidePanelProps } from "../panels";
import { IdeaBox } from "./IdeaBox";
import { MotionStyle } from "./MotionStyle";
import { SuggestionCard } from "./SuggestionCard";
import { useSlideReview } from "./useSlideReview";
import m from "./motion.module.css";

const CROWDED_PERCENT = 8; // Playbook step 5: Lively only with about 8% clearance to the text.
const dismissedKey = (reviewRunId: string) => `tiny-soho:advice-dismissed:${reviewRunId}`;

function readDismissed(reviewRunId: string) {
  try {
    return window.localStorage.getItem(dismissedKey(reviewRunId)) === "1";
  } catch {
    return false;
  }
}

/** Motion for the selected slide: three suggestions from the AI review, her own idea, and Calm or Lively. */
export function MotionPanel({ creation, slide, ready, api, editSlide }: SlidePanelProps) {
  const recordRun = useCallback((reviewRunId: string) => {
    editSlide((current) => (current.reviewRunId === reviewRunId ? current : { ...current, reviewRunId }));
  }, [editSlide]);
  const { state, retry } = useSlideReview({ api, creationId: creation.id, slide, ready, recordRun });
  const style: Style = slide.motion?.motionStyle ?? creation.document.defaults.motionStyle;
  const [pendingStyle, setPendingStyle] = useState<Style>(style);
  const [adviceHidden, setAdviceHidden] = useState(false);
  useEffect(() => setPendingStyle(style), [slide.id, style]);
  useEffect(() => {
    if (state.status === "ready") setAdviceHidden(readDismissed(state.runId));
  }, [state]);

  const setMotion = (motion: Omit<SlideMotion, "motionStyle">) => editSlide((current) => ({
    ...current,
    motion: { ...motion, motionStyle: pendingStyle } as SlideMotion,
  }));
  const chooseStyle = (next: Style) => {
    setPendingStyle(next);
    if (slide.motion) editSlide((current) => (current.motion ? { ...current, motion: { ...current.motion, motionStyle: next } } : current));
  };
  const review = state.status === "ready" ? state.review : null;

  return (
    <div className={m.panel}>
      <h2 className={m.title}>Motion</h2>
      {state.status === "waiting" && (
        <p className={m.muted}>Motion suggestions appear once this slide&rsquo;s layers pass their checks.</p>
      )}
      {state.status === "loading" && (
        <div aria-busy="true" aria-label="Reading your slide">
          <p className={m.muted}>Reading your slide…</p>
          <ul className={m.skeletons} aria-hidden="true">{[0, 1, 2].map((key) => <li key={key} />)}</ul>
        </div>
      )}
      {state.status === "failed" && (
        <div className={m.failed} role="status">
          <p>{state.message}</p>
          <button className={m.secondary} onClick={() => void retry()}>Try again</button>
        </div>
      )}
      {review && (
        <>
          <p className={m.muted}>Pick one, safest first. Suggestions favor a steady camera and clear text. Review each overlap risk.</p>
          <ul className={m.suggestions} role="radiogroup" aria-label="Suggested motions">
            {review.suggestions.map((suggestion, index) => (
              <SuggestionCard
                key={`${slide.id}-${index}`}
                group={`motion-${slide.id}`}
                suggestion={suggestion}
                index={index}
                selected={slide.motion?.source === "suggestion" && slide.motion.suggestionIndex === index}
                onChoose={() => setMotion({ source: "suggestion", suggestionIndex: index, story: suggestion.story, prompt: suggestion.prompt })}
              />
            ))}
          </ul>
          {review.design_advice && !adviceHidden && (
            <aside className={m.advice} aria-label="Design advice">
              <Icon name="help" size={15} />
              <p>{review.design_advice}</p>
              <button className={m.linkButton} onClick={() => {
                setAdviceHidden(true);
                try {
                  window.localStorage.setItem(dismissedKey(state.status === "ready" ? state.runId : ""), "1");
                } catch {
                  // Remembering the dismissal is a convenience only.
                }
              }}>Dismiss</button>
            </aside>
          )}
        </>
      )}
      <IdeaBox
        api={api}
        creationId={creation.id}
        slideId={slide.id}
        current={slide.motion?.source === "creator" ? slide.motion.story : null}
        disabled={!ready}
        onUse={(story, prompt) => setMotion({ source: "creator", story, prompt })}
      />
      <MotionStyle
        slideId={slide.id}
        value={pendingStyle}
        onChange={chooseStyle}
        crowded={review ? review.clearance_percent < CROWDED_PERCENT : false}
      />
    </div>
  );
}
