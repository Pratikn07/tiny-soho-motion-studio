import { createHash, randomInt } from "node:crypto";

import {
  ACTIVE_PIPELINE_RUN_STATUSES,
  type CheckJobOptions,
  type FinishJobOptions,
  type PipelineRunRow,
  type TakeRow,
} from "../contract.js";
import type { WorkerClient } from "../worker.js";
import type { PipelineDependencies, RunPatch } from "./steps.js";

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A stable UUID for one take's job of one kind, so a repeated insert finds the first one. */
export function derivedId(...parts: string[]) {
  const hex = sha256(parts);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const isDuplicate = (error: { code?: string } | null) => error?.code === "23505";

export type PipelineStoreOptions = {
  providerReady: PipelineDependencies["providerReady"];
  fallback: PipelineDependencies["fallback"];
  reserveBudget: PipelineDependencies["reserveBudget"];
  settleSpend: PipelineDependencies["settleSpend"];
  now?: () => number;
};

/** Supabase-backed dependencies for `advanceRun`. Every insert is idempotent on a natural key. */
export function supabasePipeline(client: WorkerClient, options: PipelineStoreOptions): PipelineDependencies {
  const now = options.now ?? Date.now;

  async function insertOnce(table: string, row: Record<string, unknown>, existing: () => Promise<{ id: string } | null>) {
    const inserted = await client.from(table).insert(row).select("*").single();
    if (!inserted.error && inserted.data) return inserted.data;
    if (isDuplicate(inserted.error)) {
      const found = await existing();
      if (found) return found;
    }
    throw new Error(`pipeline_${table}_write_failed`);
  }

  async function visionJob(run: PipelineRunRow, take: TakeRow, operation: "finish" | "check", input: {
    sourceAssetId: string;
    inputAssetIds: string[];
    options: FinishJobOptions | CheckJobOptions;
  }) {
    const idempotencyKey = derivedId(take.id, operation);
    const row = await insertOnce("creative_studio_vision_jobs", {
      project_id: run.project_id,
      owner_user_id: run.owner_user_id,
      source_asset_id: input.sourceAssetId,
      idempotency_key: idempotencyKey,
      fingerprint: sha256(input),
      operation,
      options: input.options,
      input_asset_ids: input.inputAssetIds,
      status: "queued",
    }, async () => {
      const found = await client.from("creative_studio_vision_jobs").select("id")
        .eq("project_id", run.project_id).eq("idempotency_key", idempotencyKey).maybeSingle();
      return found.data ?? null;
    });
    return row.id as string;
  }

  return {
    takes: {
      async list(runId) {
        const result = await client.from("creative_studio_takes").select("*").eq("run_id", runId).order("attempt", { ascending: true });
        if (result.error) throw new Error("pipeline_takes_read_failed");
        return (result.data ?? []) as TakeRow[];
      },
      async create(run, input) {
        return await insertOnce("creative_studio_takes", {
          run_id: run.id,
          owner_user_id: run.owner_user_id,
          project_id: run.project_id,
          slide_id: run.slide_id,
          attempt: input.attempt,
          seed: input.seed,
          model_id: input.modelId,
          provider: input.provider,
          stage: "generating",
          verdict: "pending",
        }, async () => {
          const found = await client.from("creative_studio_takes").select("*").eq("run_id", run.id).eq("attempt", input.attempt).maybeSingle();
          return found.data ?? null;
        }) as TakeRow;
      },
      async update(take, patch) {
        const result = await client.from("creative_studio_takes")
          .update({ ...patch, updated_at: new Date(now()).toISOString() })
          .eq("id", take.id)
          .eq("run_id", take.run_id);
        if (result.error) throw new Error("pipeline_take_write_failed");
      },
    },
    jobs: {
      async createProviderJob(run, take) {
        const settings = run.settings;
        const generation = {
          takeId: take.id,
          width: settings.generationWidth,
          height: settings.generationHeight,
          frames: settings.frames,
          fps: settings.fps,
          endFrameStrength: settings.endFrameStrength,
        };
        const media = [
          { assetId: settings.backgroundAssetId, role: "first_frame", ordinal: 1 },
          ...(settings.endFrameStrength !== null ? [{ assetId: settings.backgroundAssetId, role: "last_frame", ordinal: 1 }] : []),
        ];
        const job = await insertOnce("creative_studio_jobs", {
          project_id: run.project_id,
          owner_user_id: run.owner_user_id,
          idempotency_key: take.id,
          fingerprint: sha256({ take: take.id, model: take.model_id, seed: take.seed, prompt: run.prompt, generation }),
          model_id: take.model_id,
          provider: take.provider,
          seed: take.seed,
          task: "image-to-video",
          prompt: run.prompt,
          input_assets: media,
          options: generation,
          status: "queued",
        }, async () => {
          const found = await client.from("creative_studio_jobs").select("id")
            .eq("project_id", run.project_id).eq("idempotency_key", take.id).maybeSingle();
          return found.data ?? null;
        });
        for (const item of media) {
          const linked = await client.from("creative_studio_job_media").insert({
            job_id: job.id, asset_id: item.assetId, owner_user_id: run.owner_user_id, role: item.role, ordinal: item.ordinal,
          });
          if (linked.error && !isDuplicate(linked.error)) throw new Error("pipeline_job_media_write_failed");
        }
        return job.id as string;
      },
      async get(jobId) {
        const result = await client.from("creative_studio_jobs").select("status,output_asset_id,error_code").eq("id", jobId).maybeSingle();
        if (result.error || !result.data) throw new Error("pipeline_job_read_failed");
        return { status: result.data.status, outputAssetId: result.data.output_asset_id, errorCode: result.data.error_code };
      },
    },
    vision: {
      createFinish(run, take) {
        const settings = run.settings;
        return visionJob(run, take, "finish", {
          sourceAssetId: take.raw_asset_id!,
          inputAssetIds: [settings.backgroundAssetId, ...(settings.textAssetId ? [settings.textAssetId] : [])],
          options: {
            takeId: take.id,
            backgroundAssetId: settings.backgroundAssetId,
            textAssetId: settings.textAssetId,
            width: settings.slideWidth,
            height: settings.slideHeight,
            textAnimation: settings.textAnimation,
          },
        });
      },
      createCheck(run, take) {
        const settings = run.settings;
        return visionJob(run, take, "check", {
          sourceAssetId: take.raw_asset_id!,
          inputAssetIds: [take.final_asset_id!, ...(settings.textAssetId ? [settings.textAssetId] : [])],
          options: {
            takeId: take.id,
            rawAssetId: take.raw_asset_id!,
            finalAssetId: take.final_asset_id!,
            textAssetId: settings.textAssetId,
            modelId: take.model_id,
            endFramePinned: settings.endFrameStrength !== null,
            width: settings.slideWidth,
            height: settings.slideHeight,
          },
        });
      },
      async get(jobId) {
        const result = await client.from("creative_studio_vision_jobs")
          .select("status,output_asset_ids,result,error_code").eq("id", jobId).maybeSingle();
        if (result.error || !result.data) throw new Error("pipeline_vision_read_failed");
        return {
          status: result.data.status,
          outputAssetIds: result.data.output_asset_ids ?? [],
          result: result.data.result ?? null,
          errorCode: result.data.error_code,
        };
      },
    },
    async updateRun(run, patch: RunPatch) {
      const { delayMs = 10_000, ...fields } = patch;
      const result = await client.from("creative_studio_pipeline_runs")
        .update({
          ...fields,
          next_step_at: new Date(now() + delayMs).toISOString(),
          worker_lease_id: null,
          worker_lease_expires_at: null,
          updated_at: new Date(now()).toISOString(),
        })
        .eq("id", run.id)
        .eq("worker_lease_id", run.worker_lease_id)
        .in("status", [...ACTIVE_PIPELINE_RUN_STATUSES])
        .select("id");
      if (result.error) throw new Error("pipeline_run_write_failed");
      return Boolean(result.data?.length);
    },
    providerReady: options.providerReady,
    fallback: options.fallback,
    reserveBudget: options.reserveBudget,
    settleSpend: options.settleSpend,
    newSeed: () => randomInt(0, 2_147_483_647),
  };
}
