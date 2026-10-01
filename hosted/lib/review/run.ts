import type { IdeaCheckResult, SlideReview } from "../contract";
import { InvalidReviewReply, parseIdeaCheck, parseSlideReview } from "./parse";
import type { ReviewRequest } from "./prompt";
import type { Reviewer } from "./reviewers";

/** A retry only starts when at least this much of the route's time budget is left. */
const MIN_RETRY_MS = 15_000;

export type ReviewOutcome<T> = { value: T; attempts: number; costUsd: number | null };

const addCost = (total: number | null, cost: number | null) => (total === null || cost === null ? null : total + cost);

/**
 * Calls the reviewer and validates its JSON; an invalid reply is retried once if time allows. Provider errors and
 * a second invalid reply propagate (`ReviewerError`, `InvalidReviewReply`).
 */
async function withRetry<T>(
  reviewer: Reviewer,
  request: ReviewRequest,
  parse: (content: string) => T,
  deadline: number,
  now: () => number,
): Promise<ReviewOutcome<T>> {
  let costUsd: number | null = 0;
  for (let attempt = 1; ; attempt += 1) {
    const reply = await reviewer.complete(request, AbortSignal.timeout(Math.max(1, deadline - now())));
    costUsd = addCost(costUsd, reply.costUsd);
    try {
      return { value: parse(reply.content), attempts: attempt, costUsd };
    } catch (error) {
      if (!(error instanceof InvalidReviewReply) || attempt >= 2 || deadline - now() < MIN_RETRY_MS) throw error;
    }
  }
}

export function reviewSlide(
  reviewer: Reviewer,
  request: ReviewRequest,
  options: { deadline: number; now?: () => number },
): Promise<ReviewOutcome<SlideReview>> {
  return withRetry(reviewer, request, parseSlideReview, options.deadline, options.now ?? Date.now);
}

export function checkIdea(
  reviewer: Reviewer,
  request: ReviewRequest,
  options: { deadline: number; now?: () => number },
): Promise<ReviewOutcome<IdeaCheckResult>> {
  return withRetry(reviewer, request, parseIdeaCheck, options.deadline, options.now ?? Date.now);
}
