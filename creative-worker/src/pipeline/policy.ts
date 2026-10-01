import type { CheckFailureCode } from "../contract.js";

export type RetryDecision = "new_seed" | "calmer_motion" | "finish_problem" | "stop";

/**
 * What to do after the latest take was rejected (P5's `retry_decision` in creative-vision/src/checks.py).
 * `rejections`: the failed check codes of each rejected take, oldest first.
 */
export function retryDecision(rejections: readonly (readonly CheckFailureCode[])[], attemptsLeft: number): RetryDecision {
  const latest = rejections.at(-1) ?? [];
  if (latest.includes("textDrift")) return "finish_problem";
  const previous = rejections.length >= 2 ? rejections.at(-2)! : [];
  const repeated = latest.filter((code) => previous.includes(code));
  if (attemptsLeft <= 0) return "stop";
  if (repeated.includes("behindText")) return "calmer_motion";
  if (repeated.length) return "stop";
  return "new_seed";
}

/** Plain-language reason shown with a run that stopped, after the takes' own check reasons. */
export const STOP_REASONS: Record<Exclude<RetryDecision, "new_seed"> | "uncalibrated", string> = {
  calmer_motion: "The child kept moving behind your text. Try a calmer motion or the Calm style.",
  finish_problem: "Your text didn't come out exactly as designed. This is a finishing problem, not the video; please report it.",
  stop: "No take passed the checks.",
  uncalibrated: "This model hasn't been tested on your slides yet, so it wasn't retried automatically. Have a look at the take.",
};
