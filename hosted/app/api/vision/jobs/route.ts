import { requireOwner } from "@/lib/auth";
import { createVisionJobSchema } from "@/lib/creative-suite";
import { StudioError } from "@/lib/errors";
import { generationFingerprint } from "@/lib/generation";
import { routeErrorResponse } from "@/lib/http";
import { StudioRepository, type StudioAsset } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { validateVisionJobRequest } from "@/lib/vision";

const publicJob = (job: { id: string; project_id: string; source_asset_id: string; operation: string; status: string; output_asset_ids: string[]; error_code: string | null; error_message: string | null; created_at: string; updated_at: string }) => ({
  id: job.id,
  projectId: job.project_id,
  sourceAssetId: job.source_asset_id,
  operation: job.operation,
  status: job.status,
  outputAssetIds: job.output_asset_ids,
  errorCode: job.error_code,
  errorMessage: job.error_message,
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});

const visionAsset = (asset: StudioAsset | null) => asset && ({
  id: asset.id,
  projectId: asset.project_id,
  kind: asset.kind,
});

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = createVisionJobSchema.safeParse(await request.json());
    if (!parsed.success) throw new StudioError(400, "invalid_vision_request", "Vision request is invalid.");
    const repository = new StudioRepository(createServiceSupabaseClient(), owner);
    const project = await repository.getProject(parsed.data.projectId);
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");
    const [sourceAsset, ...inputAssets] = await Promise.all([
      repository.getAsset(parsed.data.sourceAssetId),
      ...parsed.data.inputAssetIds.map((assetId) => repository.getAsset(assetId)),
    ]);
    if (!sourceAsset || inputAssets.some((asset) => !asset)) {
      throw new StudioError(400, "invalid_vision_asset", "Vision assets must be owned by this Studio account.");
    }
    const capabilities = await repository.listVisionCapabilities();
    const validated = validateVisionJobRequest(parsed.data, {
      sourceAsset: visionAsset(sourceAsset),
      inputAssets: inputAssets.map(visionAsset).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)),
      capabilities: capabilities.map((capability) => ({ capabilityId: capability.capability_id, status: capability.status })),
    });
    const fingerprint = generationFingerprint({
      projectId: validated.projectId,
      sourceAssetId: validated.sourceAssetId,
      operation: validated.operation,
      options: validated.options,
      inputAssetIds: validated.inputAssetIds,
    });
    const existing = await repository.findVisionJobByIdempotency(validated.projectId, validated.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new StudioError(409, "idempotency_conflict", "This idempotency key belongs to a different Vision job.");
      }
      return Response.json({ job: publicJob(existing) });
    }
    const job = await repository.createVisionJob({
      id: crypto.randomUUID(),
      projectId: validated.projectId,
      sourceAssetId: validated.sourceAssetId,
      idempotencyKey: validated.idempotencyKey,
      fingerprint,
      operation: validated.operation,
      options: validated.options,
      inputAssetIds: validated.inputAssetIds,
    });
    return Response.json({ job: publicJob(job) }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
