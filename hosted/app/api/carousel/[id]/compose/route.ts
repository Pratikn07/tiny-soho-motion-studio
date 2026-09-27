import { POST as submitVision } from "@/app/api/vision/jobs/route";
import { compositorAvailable, generationPrompt } from "@/lib/carousel";
import { savedRun, internalRequest } from "@/lib/carousel-run";
import { routeErrorResponse } from "@/lib/http";
import { StudioError } from "@/lib/errors";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { repo, project, run } = await savedRun(
      request,
      (await context.params).id,
    );
    const generation = await repo.findJobByIdempotency(project.id, run.id);
    if (
      !generation ||
      generation.status !== "completed" ||
      !generation.output_asset_id
    )
      throw new StudioError(
        409,
        "video_not_ready",
        "The generated video is not ready for composition.",
      );
    // Recheck the immutable request, not editable current slide fields.
    const source = generation.input_assets.find(
      (a) => a.role === "first_frame",
    );
    if (
      source?.assetId !== run.snapshot.sourceAssetId ||
      generation.prompt !== generationPrompt(run.snapshot)
    )
      throw new StudioError(
        409,
        "source_changed",
        "Generation does not match this source image.",
      );
    const capabilities = await repo.listVisionCapabilities();
    if (!compositorAvailable(capabilities))
      throw new StudioError(
        503,
        "composition_not_configured",
        "The Carousel compositor is not available yet. Your generated video is saved; retry finishing later.",
      );
    return submitVision(
      internalRequest(request, {
        projectId: project.id,
        idempotencyKey: run.composeKey,
        sourceAssetId: generation.output_asset_id,
        operation: "compose",
        inputAssetIds: [run.snapshot.sourceAssetId],
        options: { carousel: run.snapshot },
      }),
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
