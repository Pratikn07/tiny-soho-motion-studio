import { POST as submitJob } from "@/app/api/jobs/route";
import {
  compositorAvailable,
  assertGenerationReady,
  generationPrompt,
  planSnapshot,
} from "@/lib/carousel";
import { savedRun, internalRequest } from "@/lib/carousel-run";
import { routeErrorResponse } from "@/lib/http";
import { StudioError } from "@/lib/errors";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { repo, project, slide, run } = await savedRun(
      request,
      (await context.params).id,
    );
    const capabilities = await repo.listVisionCapabilities();
    if (!compositorAvailable(capabilities))
      throw new StudioError(
        503,
        "composition_not_configured",
        "The Carousel compositor must be available before generating. Your plan is saved.",
      );
    assertGenerationReady(slide);
    if (JSON.stringify(planSnapshot(slide)) !== JSON.stringify(run.snapshot))
      throw new StudioError(
        409,
        "plan_changed",
        "Your plan changed. Save and review a new generation.",
      );
    return submitJob(
      internalRequest(request, {
        projectId: project.id,
        idempotencyKey: run.id,
        modelId: "wan2.7-i2v",
        prompt: generationPrompt(run.snapshot),
        media: [{ assetId: run.snapshot.sourceAssetId, role: "first_frame" }],
        options: {
          duration: 5,
          resolution: "720P",
          promptExtend: false,
          watermark: false,
        },
      }),
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
