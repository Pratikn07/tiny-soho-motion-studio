import { createHash } from "node:crypto";

import {
  reviewRunViewSchema,
  type IdeaCheckResult,
  type ReviewRunRow,
  type ReviewRunView,
  type SlideReview,
  type UploadCheckResult,
} from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import type { Owner } from "@/lib/types";

import { PLAYBOOK_MARKDOWN } from "./playbook-text";

type DataClient = { from: (table: string) => any };
type Result<T> = { data: T | null; error: unknown };

/** A run still `running` after this long was cut off (the route's time limit); it is reported as failed. */
export const STALE_RUNNING_MS = 2 * 60_000;

const unavailable = () => new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
const value = <T>(result: Result<T>) => {
  if (result.error) throw unavailable();
  return result.data;
};

const playbookHash = createHash("sha256").update(PLAYBOOK_MARKDOWN).digest("hex");

/** Same layers, checks, reviewer, playbook and idea give the same fingerprint, so a finished review is reused. */
export function reviewFingerprint(input: {
  kind: "review" | "idea-check";
  backgroundAssetId: string;
  textAssetId: string | null;
  checks?: UploadCheckResult;
  provider: string;
  model: string;
  idea?: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify({ ...input, checks: input.checks ?? null, idea: input.idea ?? null, playbookHash }))
    .digest("hex");
}

export function reviewRunView(row: ReviewRunRow, now = Date.now()): ReviewRunView {
  const stale = row.status === "running" && now - Date.parse(row.updated_at) > STALE_RUNNING_MS;
  return reviewRunViewSchema.parse({
    id: row.id,
    projectId: row.project_id,
    slideId: row.slide_id,
    status: stale ? "failed" : row.status,
    reviewerProvider: row.reviewer_provider,
    reviewerModel: row.reviewer_model,
    result: row.result,
    creatorIdea: row.creator_idea,
    creatorIdeaResult: row.creator_idea_result,
    errorCode: stale ? "review_unavailable" : row.error_code,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

export class ReviewRunsRepository {
  constructor(
    private readonly client: DataClient,
    private readonly owner: Owner,
  ) {}

  async start(input: {
    projectId: string;
    slideId: string;
    provider: string;
    model: string;
    fingerprint: string;
    creatorIdea?: string;
  }): Promise<ReviewRunRow> {
    const row = value(await this.client
      .from("creative_studio_review_runs")
      .insert({
        owner_user_id: this.owner.userId,
        project_id: input.projectId,
        slide_id: input.slideId,
        reviewer_provider: input.provider,
        reviewer_model: input.model,
        input_fingerprint: input.fingerprint,
        status: "running",
        creator_idea: input.creatorIdea ?? null,
      })
      .select("*")
      .single() as Result<ReviewRunRow>);
    if (!row) throw unavailable();
    return row;
  }

  async finish(
    id: string,
    outcome:
      | { status: "completed"; result?: SlideReview; creatorIdeaResult?: IdeaCheckResult; costUsd: number | null }
      | { status: "failed"; errorCode: string; costUsd?: number | null },
  ): Promise<ReviewRunRow> {
    const row = value(await this.client
      .from("creative_studio_review_runs")
      .update({
        status: outcome.status,
        ...(outcome.status === "completed"
          ? { result: outcome.result ?? null, creator_idea_result: outcome.creatorIdeaResult ?? null, error_code: null }
          : { error_code: outcome.errorCode }),
        cost_usd: outcome.costUsd ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_user_id", this.owner.userId)
      .select("*")
      .single() as Result<ReviewRunRow>);
    if (!row) throw unavailable();
    return row;
  }

  async get(id: string): Promise<ReviewRunRow | null> {
    return value(await this.client
      .from("creative_studio_review_runs")
      .select("*")
      .eq("id", id)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as Result<ReviewRunRow>);
  }

  /** The latest finished slide review with this fingerprint, if any. */
  async findCompletedReview(projectId: string, slideId: string, fingerprint: string): Promise<ReviewRunRow | null> {
    const rows = value(await this.client
      .from("creative_studio_review_runs")
      .select("*")
      .eq("owner_user_id", this.owner.userId)
      .eq("project_id", projectId)
      .eq("slide_id", slideId)
      .eq("input_fingerprint", fingerprint)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1) as Result<ReviewRunRow[]>) ?? [];
    return rows.find((row) => row.result !== null) ?? null;
  }
}
