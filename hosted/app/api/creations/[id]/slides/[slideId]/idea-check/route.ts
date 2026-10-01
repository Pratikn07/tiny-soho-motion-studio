import { ideaCheckRequestSchema, type IdeaCheckResponse } from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import { routeErrorResponse } from "@/lib/http";
import { reviewImages } from "@/lib/review/images";
import { ideaCheckRequest } from "@/lib/review/prompt";
import { reviewFingerprint } from "@/lib/review/repository";
import { checkIdea } from "@/lib/review/run";
import { failureReason, openSlideReview } from "@/lib/review/slide-inputs";

export const maxDuration = 60;
const BUDGET_MS = 50_000;

export async function POST(request: Request, context: { params: Promise<{ id: string; slideId: string }> }) {
  const started = Date.now();
  try {
    const scope = await openSlideReview(request, context.params);
    const { idea } = ideaCheckRequestSchema.parse(await request.json());
    const run = await scope.runs.start({
      projectId: scope.projectId,
      slideId: scope.slideId,
      provider: scope.reviewer.provider,
      model: scope.reviewer.model,
      fingerprint: reviewFingerprint({
        kind: "idea-check",
        backgroundAssetId: scope.slide.layers.backgroundAssetId!,
        textAssetId: scope.slide.layers.textAssetId,
        checks: scope.slide.checks,
        provider: scope.reviewer.provider,
        model: scope.reviewer.model,
        idea,
      }),
      creatorIdea: idea,
    });
    try {
      const text = await scope.text();
      const outcome = await checkIdea(scope.reviewer, ideaCheckRequest({
        images: await reviewImages(await scope.background(), text),
        hasText: text !== null,
        slideName: scope.slide.name,
        checks: scope.slide.checks,
        idea,
      }), { deadline: started + BUDGET_MS });
      await scope.runs.finish(run.id, { status: "completed", creatorIdeaResult: outcome.value, costUsd: outcome.costUsd });
      const body: IdeaCheckResponse = { reviewRunId: run.id, result: outcome.value };
      return Response.json(body);
    } catch (error) {
      console.warn("idea-check-failed", { reason: failureReason(error) });
      await scope.runs.finish(run.id, { status: "failed", errorCode: "review_unavailable" });
      throw new StudioError(502, "review_unavailable", "Your idea couldn't be checked right now. You can still use it as written.");
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
