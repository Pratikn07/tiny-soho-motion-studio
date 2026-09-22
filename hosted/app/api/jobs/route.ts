import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { generationFingerprint } from "@/lib/generation";
import { routeErrorResponse } from "@/lib/http";
import { createOrGetJob } from "@/lib/jobs";
import { StudioRepository, type StudioAsset, type StudioJob } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { signAssetDownload } from "@/lib/storage";
import { preflightVideoGeneration, type MediaRole } from "@/lib/video-catalog";

const mediaRoleSchema = z.enum([
  "first_frame", "last_frame", "mask_image", "reference_image", "reference_video",
  "source_video", "driving_video", "driving_audio", "first_clip",
]);

const requestSchema = z.object({
  projectId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  modelId: z.string().min(1).max(120),
  prompt: z.string().max(5000),
  media: z.array(z.object({
    assetId: z.string().uuid(),
    role: mediaRoleSchema,
    ordinal: z.number().int().positive().optional(),
  })).max(20),
  options: z.record(z.unknown()),
});

const publicJob = (job: StudioJob, outputUrl?: string) => ({
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
  ...(outputUrl ? { outputUrl } : {}),
  createdAt: job.created_at,
  updatedAt: job.updated_at,
});

const expectedAssetKind: Record<MediaRole, StudioAsset["kind"]> = {
  first_frame: "source-image",
  last_frame: "source-image",
  mask_image: "source-image",
  reference_image: "source-image",
  reference_video: "source-video",
  source_video: "source-video",
  driving_video: "source-video",
  driving_audio: "source-audio",
  first_clip: "source-video",
};

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const projectId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("projectId"));
    if (!projectId.success) throw new StudioError(400, "invalid_project_id", "Project ID is invalid.");

    const client = createServiceSupabaseClient();
    const repository = new StudioRepository(client, owner);
    const jobs = await repository.listJobs(projectId.data);
    const views = await Promise.all(jobs.map(async (job) => {
      const outputAsset = job.output_asset_id ? await repository.getAsset(job.output_asset_id) : null;
      const outputUrl = outputAsset ? await signAssetDownload(client, outputAsset.object_path) : undefined;
      return publicJob(job, outputUrl);
    }));
    return Response.json({ jobs: views });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) throw new StudioError(400, "invalid_generation_request", "Generation request is invalid.");

    const client = createServiceSupabaseClient();
    const repository = new StudioRepository(client, owner);
    const project = await repository.getProject(parsed.data.projectId);
    if (!project) throw new StudioError(404, "project_not_found", "Project was not found.");

    const acknowledgements = await repository.listModelAcknowledgements();
    const prepared = preflightVideoGeneration({
      ...parsed.data,
      acknowledgements: acknowledgements.map((acknowledgement) => ({
        modelId: acknowledgement.model_id,
        contractVersion: acknowledgement.contract_version,
      })),
    });
    const assets = await Promise.all(prepared.media.map(async (media) => {
      const asset = await repository.getAsset(media.assetId);
      if (!asset || asset.project_id !== project.id || asset.kind !== expectedAssetKind[media.role]) {
        throw new StudioError(400, "invalid_generation_asset", "Generation media must be an owned source asset of the correct type in this project.");
      }
      return { media };
    }));
    const fingerprint = generationFingerprint({
      modelId: prepared.contract.id,
      contractVersion: prepared.contract.contractVersion,
      prompt: prepared.prompt,
      media: prepared.media,
      options: prepared.options,
    });
    const created = await createOrGetJob(
      {
        find: () => repository.findJobByIdempotency(project.id, parsed.data.idempotencyKey),
        create: () => repository.createJob({
          id: crypto.randomUUID(),
          projectId: project.id,
          idempotencyKey: parsed.data.idempotencyKey,
          fingerprint,
          modelId: prepared.contract.id,
          task: prepared.contract.task,
          prompt: prepared.prompt,
          inputAssets: prepared.media.map(({ assetId, role, ordinal }) => ({ assetId, role, ordinal })),
          options: prepared.options,
          initialStatus: "submitting",
        }),
      },
      { idempotencyKey: parsed.data.idempotencyKey, fingerprint },
    );
    if (!created.created) return Response.json({ job: publicJob(created.job) });

    try {
      await Promise.all(assets.map(({ media }) => repository.createJobMedia({
        jobId: created.job.id,
        assetId: media.assetId,
        role: media.role,
        ordinal: media.ordinal,
      })));
      const queued = await repository.transitionJob(created.job.id, "submitting", { status: "queued" });
      if (!queued) throw new StudioError(409, "job_state_changed", "Generation state changed; refresh and try again.");
      return Response.json({ job: publicJob(queued) }, { status: 202 });
    } catch (error) {
      await repository.updateJob(created.job.id, {
        status: "needs_attention",
        errorCode: "job_media_persistence_failed",
        errorMessage: "Generation inputs need review before provider submission.",
      });
      throw error;
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
