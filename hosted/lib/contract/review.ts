import { z } from "zod";

/** The camera sentence every generation prompt ends with (playbook, step 5, rule 6). */
export const STATIC_CAMERA_SENTENCE = "The camera remains static throughout, with no zoom, no pan and no cut.";

const percent = z.number().min(0).max(100);

export const REVIEW_RISK_TYPES = [
  "subject_close_to_text",
  "dark_on_dark",
  "room_to_walk_toward_text",
  "close_up_invitation",
  "small_faces",
  "text_layer_problems",
  "other",
] as const;

/** `risk` starts with the level, optionally followed by `: reason` ("some risk: may lean toward 'basics:'"). */
export const suggestionRiskSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^(safe|some risk|risky)(: .+)?$/, "risk starts with safe, some risk or risky.");

export const motionSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(150),
  story: z.string().trim().min(1).max(1000),
  risk: suggestionRiskSchema,
  end_strength: z.number().min(0).max(1),
  prompt: z.string().trim().min(1).max(5000),
});
export type MotionSuggestion = z.infer<typeof motionSuggestionSchema>;

export const creatorIdeaReviewSchema = z.object({
  verdict: z.enum(["ok", "adjust"]),
  reason: z.string().trim().min(1).max(1000),
  suggested_idea: z.string().trim().min(1).max(1000).optional(),
  prompt: z.string().trim().min(1).max(5000),
});

/** The reviewer's JSON for one slide: the playbook's output format ("Output format"). */
export const slideReviewSchema = z.object({
  slide: z.string().trim().max(160).optional(),
  subject: z.string().trim().min(1).max(1000),
  message: z.string().trim().min(1).max(1000),
  text_zones: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(160),
        x: percent,
        y: percent,
        width: percent,
        height: percent,
      }),
    )
    .max(20),
  clearance_percent: percent,
  risks: z
    .array(
      z.object({
        type: z.enum(REVIEW_RISK_TYPES),
        detail: z.string().trim().min(1).max(500),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(10),
  suggestions: z.array(motionSuggestionSchema).length(3),
  design_advice: z.string().trim().min(1).max(1000).nullable(),
  creator_idea_review: creatorIdeaReviewSchema.nullable(),
});
export type SlideReview = z.infer<typeof slideReviewSchema>;

export const REVIEW_RUN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export const reviewRunStatusSchema = z.enum(REVIEW_RUN_STATUSES);
export type ReviewRunStatus = z.infer<typeof reviewRunStatusSchema>;

/**
 * `POST .../idea-check` result. Her idea is never replaced unless she accepts `suggestedIdea`: `prompt` is always
 * for her idea as written ("Keep mine"), `suggestedPrompt` for the suggested change ("Use suggestion").
 */
export const ideaCheckResultSchema = z
  .object({
    verdict: z.enum(["ok", "adjust"]),
    reason: z.string().trim().min(1).max(1000),
    suggestedIdea: z.string().trim().min(1).max(1000).optional(),
    prompt: z.string().trim().min(1).max(5000),
    suggestedPrompt: z.string().trim().min(1).max(5000).optional(),
  })
  .refine(
    (result) => result.verdict === "ok" || (result.suggestedIdea !== undefined && result.suggestedPrompt !== undefined),
    "An adjust verdict offers the smallest change as suggestedIdea with its suggestedPrompt.",
  );
export type IdeaCheckResult = z.infer<typeof ideaCheckResultSchema>;

export const ideaCheckRequestSchema = z.object({
  idea: z.string().trim().min(1).max(1000),
});
export type IdeaCheckRequest = z.infer<typeof ideaCheckRequestSchema>;

export const reviewRunViewSchema = z
  .object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  slideId: z.string().uuid(),
  status: reviewRunStatusSchema,
  reviewerProvider: z.string().trim().min(1).max(40),
  reviewerModel: z.string().trim().min(1).max(160),
  result: slideReviewSchema.nullable(),
  creatorIdea: z.string().max(1000).nullable(),
  creatorIdeaResult: ideaCheckResultSchema.nullable(),
  errorCode: z.string().max(120).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})
  .refine(
    (run) => run.status !== "completed" || run.result !== null || run.creatorIdeaResult !== null,
    "A completed review run has a result.",
  )
  .refine((run) => run.status !== "failed" || run.errorCode !== null, "A failed review run has an error code.");
export type ReviewRunView = z.infer<typeof reviewRunViewSchema>;

/** `creative_studio_review_runs` row (service role only). */
export type ReviewRunRow = {
  id: string;
  owner_user_id: string;
  project_id: string;
  slide_id: string;
  reviewer_provider: string;
  reviewer_model: string;
  input_fingerprint: string;
  status: ReviewRunStatus;
  result: SlideReview | null;
  creator_idea: string | null;
  creator_idea_result: IdeaCheckResult | null;
  cost_usd: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};
