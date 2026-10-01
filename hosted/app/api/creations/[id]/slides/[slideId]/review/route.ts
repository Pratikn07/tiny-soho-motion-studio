import { z } from "zod";

import type { ReviewRunResponse } from "@/lib/contract";
import { routeErrorResponse } from "@/lib/http";
import { reviewImages } from "@/lib/review/images";
import { slideReviewRequest } from "@/lib/review/prompt";
import { reviewFingerprint, reviewRunView } from "@/lib/review/repository";
import { reviewSlide } from "@/lib/review/run";
import { failureReason, openSlideReview } from "@/lib/review/slide-inputs";

export const maxDuration = 60;
const BUDGET_MS = 50_000;

const bodySchema = z.object({ force: z.boolean().default(false) });

export async function POST(request: Request, context: { params: Promise<{ id: string; slideId: string }> }) {
  const started = Date.now();
  try {
    const scope = await openSlideReview(request, context.params);
    const { force } = bodySchema.parse(await request.json().catch(() => ({})));
    const fingerprint = reviewFingerprint({
      kind: "review",
      backgroundAssetId: scope.slide.layers.backgroundAssetId!,
      textAssetId: scope.slide.layers.textAssetId,
      checks: scope.slide.checks,
      provider: scope.reviewer.provider,
      model: scope.reviewer.model,
    });
    const reused = force ? null : await scope.runs.findCompletedReview(scope.projectId, scope.slideId, fingerprint);
    if (reused) {
      const body: ReviewRunResponse = { reviewRun: reviewRunView(reused) };
      return Response.json(body);
    }

    const run = await scope.runs.start({
      projectId: scope.projectId,
      slideId: scope.slideId,
      provider: scope.reviewer.provider,
      model: scope.reviewer.model,
      fingerprint,
    });
    let finished;
    try {
      const text = await scope.text();
      const reviewRequest = slideReviewRequest({
        images: await reviewImages(await scope.background(), text),
        hasText: text !== null,
        slideName: scope.slide.name,
        checks: scope.slide.checks,
      });
      const outcome = await reviewSlide(scope.reviewer, reviewRequest, { deadline: started + BUDGET_MS });
      finished = await scope.runs.finish(run.id, { status: "completed", result: outcome.value, costUsd: outcome.costUsd });
    } catch (error) {
      console.warn("slide-review-failed", { reason: failureReason(error) });
      finished = await scope.runs.finish(run.id, { status: "failed", errorCode: "review_unavailable" });
    }
    const body: ReviewRunResponse = { reviewRun: reviewRunView(finished) };
    return Response.json(body, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
