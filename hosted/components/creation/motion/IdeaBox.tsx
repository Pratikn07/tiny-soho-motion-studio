"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Icon from "@/components/carousel/Icons";
import { CreationApiError, type CreationApi } from "../api";
import { reviewClient, type IdeaCheck } from "./client";
import m from "./motion.module.css";

type Props = {
  api: CreationApi;
  creationId: string;
  slideId: string;
  /** Her idea if it is the slide's current motion. */
  current: string | null;
  disabled: boolean;
  /** Uses an idea with its model prompt as the slide's motion. */
  onUse: (story: string, prompt: string) => void;
};

/**
 * "Or describe your own": the AI checks her idea against the slide's risks. A safe idea is used as written; a risky
 * one shows the specific problem and the smallest change, and her words stay unless she picks the suggestion.
 */
export function IdeaBox({ api, creationId, slideId, current, disabled, onUse }: Props) {
  const client = useMemo(() => reviewClient(api), [api]);
  const [idea, setIdea] = useState(current ?? "");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<(IdeaCheck & { idea: string }) | null>(null);
  const [error, setError] = useState("");
  const lastChecked = useRef(current ?? "");

  const currentRef = useRef(current);
  currentRef.current = current;
  // A different slide starts fresh; using an idea on this slide keeps the result on screen.
  useEffect(() => {
    setIdea(currentRef.current ?? "");
    lastChecked.current = currentRef.current ?? "";
    setResult(null);
    setError("");
  }, [slideId]);

  const check = async (text = idea) => {
    const trimmed = text.trim();
    if (!trimmed || checking) return;
    lastChecked.current = trimmed;
    setChecking(true);
    setError("");
    setResult(null);
    try {
      const outcome = await client.checkIdea(creationId, slideId, trimmed);
      setResult({ ...outcome, idea: trimmed });
      if (outcome.verdict === "ok") onUse(trimmed, outcome.prompt);
    } catch (caught) {
      setError(caught instanceof CreationApiError ? caught.message : "Your idea couldn't be checked right now. Try again.");
    } finally {
      setChecking(false);
    }
  };

  const useSuggestion = async () => {
    if (!result?.suggestedIdea) return;
    const suggested = result.suggestedIdea;
    setIdea(suggested);
    if (result.suggestedPrompt) {
      onUse(suggested, result.suggestedPrompt);
      setResult({ ...result, verdict: "ok", reason: "Using the suggested change.", idea: suggested });
    } else {
      await check(suggested); // Gets the prompt for the suggested wording.
    }
  };

  return (
    <section className={m.idea} aria-labelledby={`idea-${slideId}`}>
      <label id={`idea-${slideId}`} htmlFor={`idea-text-${slideId}`} className={m.ideaLabel}>Or describe your own</label>
      <textarea
        id={`idea-text-${slideId}`}
        value={idea}
        rows={3}
        maxLength={1000}
        disabled={disabled}
        placeholder="For example: she lifts the towel, looks at it and smiles."
        onChange={(event) => setIdea(event.target.value)}
        onBlur={() => { if (idea.trim() && idea.trim() !== lastChecked.current) void check(); }}
      />
      <div className={m.ideaActions}>
        <button className={m.secondary} onClick={() => void check()} disabled={disabled || checking || !idea.trim()}>
          {checking ? "Checking…" : "Check my idea"}
        </button>
        {current && current === idea.trim() && !result && <span className={m.using}><Icon name="check" size={12} /> Using your idea</span>}
      </div>
      <div aria-live="polite">
        {result?.verdict === "ok" && (
          <p className={m.ideaOk}><Icon name="check" size={13} /> Looks good. {result.reason}</p>
        )}
        {result?.verdict === "adjust" && (
          <div className={m.ideaAdjust}>
            <p><strong>One change would help.</strong> {result.reason}</p>
            {result.suggestedIdea && <p className={m.suggestedIdea}>“{result.suggestedIdea}”</p>}
            <div className={m.ideaActions}>
              <button className={m.primary} onClick={() => void useSuggestion()} disabled={checking}>Use suggestion</button>
              <button className={m.secondary} onClick={() => { onUse(result.idea, result.prompt); setResult(null); }} disabled={checking}>
                Keep mine
              </button>
            </div>
          </div>
        )}
        {error && <p className={m.ideaError} role="alert">{error}</p>}
      </div>
    </section>
  );
}
