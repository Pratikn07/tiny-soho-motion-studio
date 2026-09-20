import { z } from "zod";

import { submitWanJob } from "@/lib/alibaba";
import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { requireServerEnv } from "@/lib/env";
import { generationFingerprint, preflightGeneration } from "@/lib/generation";
import { routeErrorResponse } from "@/lib/http";
import { createOrGetJob } from "@/lib/jobs";
import { StudioRepository, type StudioAsset, type StudioJob } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  modelId: z.enum(["wan2.7-i2v", "wan3-video"]),
  prompt: z.string(),
  media: z.array(z.object({
    assetId: z.string().uuid(),
    role: z.enum(["start-image", "end-image"]),
  })).min(1).max(2),
  options: z.object({
    duration: z.number().int().optional(),
    resolution: z.string().optional(),
    aspectRatio: z.string().optional(),
  }),
});

const publicJob = (job: StudioJob) => ({
  id: job.id,
  projectId: job.project_id,
  modelId: job.model_id,
  prompt: job.prompt,
  inputAssets: job.input_assets,
  options: job.options,
  status: job.status,
  outputAssetId: job.output_asset_id,
  errorCode: job.error_code,
  errorMessage: job.error_message,
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});

async function providerInputFor(client: ReturnType<typeof createServiceSupabaseClient>, asset: StudioAsset, role: "start-image" | "end-image") {
  const { data, error } = await client.storage.from("creative-studio").download(asset.object_path);
  if (error || !data) {
    throw new StudioError(502, "studio_storage_read_failed", "Source image could not be read.");
  }
  return {
    role,
    mimeType: asset.mime_type,
    bytes: Buffer.from(await data.arrayBuffer()),
  } as const;
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new StudioError(400, "invalid_generation_request", "Generation request is invalid.");
    }

    const client = createServiceSupabaseClient();
    const repository = new StudioRepository(client, owner);
    const project = await repository.getProject(parsed.data.projectId);
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");

    const assets = await Promise.all(parsed.data.media.map(async (media) => {
      const asset = await repository.getAsset(media.assetId);
      if (!asset || asset.project_id !== project.id || asset.kind !== "source-image") {
        throw new StudioError(400, "invalid_generation_asset", "Generation media must be an owned source image in this project.");
      }
      return { asset, role: media.role };
    }));

    const prepared = preflightGeneration({
      ...parsed.data,
      freeQuotaModels: project.free_quota_models,
    });
    const fingerprint = generationFingerprint(prepared);
    const created = await createOrGetJob(
      {
        find: () => repository.findJobByIdempotency(project.id, parsed.data.idempotencyKey),
        create: () => repository.createJob({
          id: crypto.randomUUID(),
          projectId: project.id,
          idempotencyKey: parsed.data.idempotencyKey,
          fingerprint,
          modelId: prepared.modelId,
          prompt: prepared.prompt,
          inputAssets: prepared.media,
          options: prepared.options,
        }),
      },
      { idempotencyKey: parsed.data.idempotencyKey, fingerprint },
    );
    if (!created.created) return Response.json({ job: publicJob(created.job) });

    const claimed = await repository.transitionJob(created.job.id, "queued", { status: "submitting" });
    if (!claimed) return Response.json({ job: publicJob(created.job) }, { status: 202 });

    try {
      const serverEnv = requireServerEnv();
      const providerMedia = await Promise.all(assets.map(({ asset, role }) => providerInputFor(client, asset, role)));
      const provider = await submitWanJob(
        { modelId: prepared.modelId, prompt: prepared.prompt, options: prepared.options },
        providerMedia,
        { apiKey: serverEnv.dashscopeApiKey, workspaceId: serverEnv.alibabaWorkspaceId },
      );
      const submitted = await repository.transitionJob(claimed.id, "submitting", {
        status: "submitted",
        providerTaskId: provider.providerTaskId,
      });
      if (!submitted) {
        const review = await repository.updateJob(claimed.id, {
          status: "needs_attention",
          errorCode: "provider_submission_uncertain",
          errorMessage: "Provider submission needs review before retrying.",
        });
        return Response.json({ job: publicJob(review ?? claimed) }, { status: 202 });
      }
      return Response.json({ job: publicJob(submitted) }, { status: 202 });
    } catch {
      const review = await repository.updateJob(claimed.id, {
        status: "needs_attention",
        errorCode: "provider_submission_uncertain",
        errorMessage: "Provider submission needs review before retrying.",
      });
      return Response.json({ job: publicJob(review ?? claimed) }, { status: 202 });
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
