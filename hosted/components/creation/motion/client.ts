import {
  ideaCheckResponseSchema,
  reviewRunResponseSchema,
  type IdeaCheckResult,
  type ReviewRunView,
} from "@/lib/contract";
import type { CreationApi } from "../api";

export type IdeaCheck = IdeaCheckResult & {
  reviewRunId: string;
  /** The model prompt for `suggestedIdea` (P1). Older replies don't have it; the panel then checks that idea. */
  suggestedPrompt?: string;
};

const slidePath = (creationId: string, slideId: string) => `/api/creations/${creationId}/slides/${slideId}`;

/** P1's review endpoints, through the creation API's sign-in. */
export function reviewClient(api: CreationApi) {
  return {
    async start(creationId: string, slideId: string, force = false): Promise<ReviewRunView> {
      const body = await api.fetchJson(`${slidePath(creationId, slideId)}/review`, { method: "POST", body: { force } });
      return reviewRunResponseSchema.parse(body).reviewRun;
    },
    async get(reviewRunId: string): Promise<ReviewRunView> {
      return reviewRunResponseSchema.parse(await api.fetchJson(`/api/review-runs/${reviewRunId}`)).reviewRun;
    },
    async checkIdea(creationId: string, slideId: string, idea: string): Promise<IdeaCheck> {
      const raw = await api.fetchJson(`${slidePath(creationId, slideId)}/idea-check`, { method: "POST", body: { idea } });
      const parsed = ideaCheckResponseSchema.parse(raw);
      const suggestedPrompt = (raw as { result?: { suggestedPrompt?: unknown } }).result?.suggestedPrompt;
      return {
        ...parsed.result,
        reviewRunId: parsed.reviewRunId,
        ...(typeof suggestedPrompt === "string" && suggestedPrompt.trim() ? { suggestedPrompt } : {}),
      };
    },
  };
}

/** "safe", "some risk: may lean toward…" → level and reason (T0 `suggestionRiskSchema`). */
export function readRisk(risk: string): { level: "safe" | "some risk" | "risky"; reason: string | null } {
  const match = /^(safe|some risk|risky)(?:: (.+))?$/.exec(risk.trim());
  if (!match) return { level: "some risk", reason: risk };
  return { level: match[1] as "safe" | "some risk" | "risky", reason: match[2] ?? null };
}
