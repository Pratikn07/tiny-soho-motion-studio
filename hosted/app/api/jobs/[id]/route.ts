import { z } from "zod";

import { checkWanTask } from "@/lib/alibaba";
import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
import { requireServerEnv } from "@/lib/env";
import { routeErrorResponse } from "@/lib/http";
import { synchronizeJob } from "@/lib/jobs";
import { StudioRepository, type StudioJob } from "@/lib/repository";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { ingestGeneratedVideo, signAssetDownload } from "@/lib/storage";

const jobIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const jobId = jobIdSchema.safeParse((await context.params).id);
    if (!jobId.success) throw new StudioError(400, "invalid_job_id", "Job ID is invalid.");

    const client = createServiceSupabaseClient();
    const repository = new StudioRepository(client, owner);
    const job = await repository.getJob(jobId.data);
    if (!job) throw new StudioError(404, "job_not_found", "Job was not found.");

    const synchronized = job.status === "queued" || job.status === "submitting" ? job : await synchronizeJob(job, {
      checkTask: async (providerTaskId) => {
        const serverEnv = requireServerEnv();
        return checkWanTask(providerTaskId, {
          apiKey: serverEnv.dashscopeApiKey,
          workspaceId: serverEnv.alibabaWorkspaceId,
        });
      },
      claimDownload: async () => Boolean(await repository.transitionJob(job.id, job.status, { status: "downloading" })),
      ingestResult: async (providerUrl) => {
        const assetId = crypto.randomUUID();
        const ingested = await ingestGeneratedVideo({
          client,
          ownerUserId: owner.userId,
          projectId: job.project_id,
          assetId,
          providerUrl,
        });
        try {
          await repository.createAsset({
            id: assetId,
            projectId: job.project_id,
            kind: "generated-video",
            name: "Generated video.mp4",
            mimeType: ingested.mimeType,
            objectPath: ingested.objectPath,
            byteSize: ingested.bytes.byteLength,
            width: null,
            height: null,
            durationSeconds: null,
            sha256: ingested.sha256,
            provenance: { provider: "alibaba", providerTaskId: job.provider_task_id },
          });
        } catch (error) {
          await client.storage.from("creative-studio").remove([ingested.objectPath]);
          throw error;
        }
        return { outputAssetId: assetId };
      },
      update: async (patch) => repository.updateJob(job.id, patch),
    });

    const current = synchronized as StudioJob | null;
    if (!current) throw new StudioError(409, "job_state_changed", "Job state changed; refresh and try again.");
    const outputAsset = current.output_asset_id ? await repository.getAsset(current.output_asset_id) : null;
    const outputUrl = outputAsset ? await signAssetDownload(client, outputAsset.object_path) : undefined;
    return Response.json({ job: publicJob(current, outputUrl) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
