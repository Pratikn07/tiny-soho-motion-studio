import { z } from "zod";

import {
  STATIC_CAMERA_SENTENCE,
  ideaCheckResultSchema,
  slideReviewSchema,
  type IdeaCheckResult,
  type SlideReview,
} from "../contract";

export class InvalidReviewReply extends Error {
  constructor(readonly reason: "json" | "schema") {
    super(`review_reply_invalid_${reason}`);
    this.name = "InvalidReviewReply";
  }
}

/** The first JSON object in a reply, tolerating code fences and prose around it. */
export function extractJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through to the invalid-JSON error.
      }
    }
  }
  throw new InvalidReviewReply("json");
}

const riskOrder = (risk: string) => (risk.startsWith("safe") ? 0 : risk.startsWith("some risk") ? 1 : 2);

/** Every prompt ends with the camera sentence exactly once (playbook, step 5, rule 6). */
export function withCameraSentence(prompt: string) {
  const trimmed = prompt.trim();
  if (trimmed.endsWith(STATIC_CAMERA_SENTENCE)) return trimmed;
  return `${trimmed.replace(/\s*The camera remains static[^.]*\.?\s*$/i, "").replace(/[\s.]*$/, ".")} ${STATIC_CAMERA_SENTENCE}`;
}

const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidReviewReply("schema");
  return parsed.data;
};

/** Validates the reviewer's JSON, orders suggestions safest first and enforces the camera sentence. */
export function parseSlideReview(content: string): SlideReview {
  const review = parse(slideReviewSchema, extractJson(content));
  const suggestions = review.suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((a, b) => riskOrder(a.suggestion.risk) - riskOrder(b.suggestion.risk) || a.index - b.index)
    .map(({ suggestion }) => ({ ...suggestion, prompt: withCameraSentence(suggestion.prompt) }));
  return { ...review, suggestions };
}

const ideaReplySchema = z.object({
  verdict: z.enum(["ok", "adjust"]),
  reason: z.string(),
  suggested_idea: z.string().nullish(),
  prompt: z.string(),
  suggested_prompt: z.string().nullish(),
});

export function parseIdeaCheck(content: string): IdeaCheckResult {
  const reply = parse(ideaReplySchema, extractJson(content));
  const adjust = reply.verdict === "adjust";
  return parse(ideaCheckResultSchema, {
    verdict: reply.verdict,
    reason: reply.reason,
    prompt: withCameraSentence(reply.prompt),
    ...(adjust && reply.suggested_idea ? { suggestedIdea: reply.suggested_idea } : {}),
    ...(adjust && reply.suggested_prompt ? { suggestedPrompt: withCameraSentence(reply.suggested_prompt) } : {}),
  });
}
