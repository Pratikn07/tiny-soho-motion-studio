import { StudioError } from "@/lib/errors";
import type { StudioDirectorProposal, StudioDirectorRequest, StudioVisionJob, StudioWorkflowRun } from "@/lib/creative-suite";
import type { DirectorApprovalJob } from "@/lib/director";
import type { StudioJobStatus } from "@/lib/jobs";
import type { OwnedRecord, Owner } from "@/lib/types";
import type { MediaRole, VideoTask } from "@/lib/video-catalog";

export const projectFilter = (ownerUserId: string) => ({ owner_user_id: ownerUserId });

export const visibleAsset = <T extends OwnedRecord>(
  asset: T | null,
  ownerUserId: string,
) => (asset?.owner_user_id === ownerUserId ? asset : null);

export type StudioProject = OwnedRecord & {
  name: string;
  canvas: string;
  free_quota_models: string[];
  free_quota_confirmed_at: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type StudioAsset = OwnedRecord & {
  project_id: string;
  kind: "source-image" | "source-video" | "source-audio" | "generated-video" | "derived-image" | "derived-video";
  name: string;
  mime_type: string;
  object_path: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sha256: string;
  provenance: Record<string, unknown>;
  created_at: string;
};

export type StudioModelAcknowledgement = OwnedRecord & {
  model_id: string;
  contract_version: string;
  acknowledgement_text_version: string;
  billing_acknowledged_at: string;
  created_at: string;
};

export type StudioJob = OwnedRecord & {
  project_id: string;
  idempotency_key: string;
  fingerprint: string;
  model_id: string;
  task: VideoTask;
  prompt: string;
  input_assets: Array<{ assetId: string; role: string; ordinal?: number }>;
  options: Record<string, unknown>;
  status: StudioJobStatus;
  provider_task_id: string | null;
  output_asset_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type DatabaseResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type StudioDataClient = {
  from: (table: string) => any;
  rpc?: (fn: string, args: Record<string, unknown>) => any;
};

const databaseResult = <T>(result: DatabaseResult<T>) => {
  if (result.error) {
    throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
  }
  return result.data;
};

export class StudioRepository {
  constructor(
    private readonly client: StudioDataClient,
    private readonly owner: Owner,
  ) {}

  async getProject(projectId: string): Promise<StudioProject | null> {
    const result = await this.client
      .from("creative_studio_projects")
      .select("*")
      .eq("id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as DatabaseResult<StudioProject>;

    return databaseResult(result);
  }

  async listProjects(): Promise<StudioProject[]> {
    const result = await this.client
      .from("creative_studio_projects")
      .select("*")
      .eq("owner_user_id", this.owner.userId)
      .order("updated_at", { ascending: false }) as DatabaseResult<StudioProject[]>;
    return databaseResult(result) ?? [];
  }

  async createProject(input: { name: string; canvas: string }): Promise<StudioProject> {
    const result = await this.client
      .from("creative_studio_projects")
      .insert({
        owner_user_id: this.owner.userId,
        name: input.name,
        canvas: input.canvas,
      })
      .select("*")
      .single() as DatabaseResult<StudioProject>;
    const project = databaseResult(result);
    if (!project) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return project;
  }

  async createDirectorRequest(input: {
    id: string;
    projectId: string;
    idempotencyKey: string;
    fingerprint: string;
    brief: string;
  }): Promise<StudioDirectorRequest> {
    const result = await this.client
      .from("creative_studio_director_requests")
      .insert({
        id: input.id,
        project_id: input.projectId,
        owner_user_id: this.owner.userId,
        idempotency_key: input.idempotencyKey,
        fingerprint: input.fingerprint,
        brief: input.brief,
        status: "queued",
      })
      .select("*")
      .single() as DatabaseResult<StudioDirectorRequest>;
    const request = databaseResult(result);
    if (!request) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return request;
  }

  async findDirectorRequestByIdempotency(projectId: string, idempotencyKey: string): Promise<StudioDirectorRequest | null> {
    const result = await this.client
      .from("creative_studio_director_requests")
      .select("*")
      .eq("project_id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle() as DatabaseResult<StudioDirectorRequest>;
    return databaseResult(result);
  }

  async getDirectorProposal(proposalId: string): Promise<StudioDirectorProposal | null> {
    const result = await this.client
      .from("creative_studio_director_proposals")
      .select("*")
      .eq("id", proposalId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as DatabaseResult<StudioDirectorProposal>;
    return databaseResult(result);
  }

  async approveDirectorProposal(input: {
    proposalId: string;
    expectedFingerprint: string;
    jobs: DirectorApprovalJob[];
  }): Promise<StudioJob[]> {
    if (!this.client.rpc) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    const result = await this.client.rpc("approve_creative_studio_director_proposal", {
      proposal_id: input.proposalId,
      proposal_owner_user_id: this.owner.userId,
      expected_fingerprint: input.expectedFingerprint,
      child_jobs: input.jobs,
    }) as DatabaseResult<StudioJob[]>;
    return databaseResult(result) ?? [];
  }

  async createWorkflowRun(input: {
    id: string;
    workflowId: string;
    projectId: string;
    idempotencyKey: string;
    graphSnapshot: Record<string, unknown>;
  }): Promise<StudioWorkflowRun> {
    const result = await this.client
      .from("creative_studio_workflow_runs")
      .insert({
        id: input.id,
        workflow_id: input.workflowId,
        project_id: input.projectId,
        owner_user_id: this.owner.userId,
        idempotency_key: input.idempotencyKey,
        graph_snapshot: input.graphSnapshot,
        node_state: {},
        status: "queued",
      })
      .select("*")
      .single() as DatabaseResult<StudioWorkflowRun>;
    const run = databaseResult(result);
    if (!run) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return run;
  }

  async createVisionJob(input: {
    id: string;
    projectId: string;
    sourceAssetId: string;
    idempotencyKey: string;
    operation: StudioVisionJob["operation"];
    options: Record<string, unknown>;
    inputAssetIds: string[];
  }): Promise<StudioVisionJob> {
    const result = await this.client
      .from("creative_studio_vision_jobs")
      .insert({
        id: input.id,
        project_id: input.projectId,
        owner_user_id: this.owner.userId,
        source_asset_id: input.sourceAssetId,
        idempotency_key: input.idempotencyKey,
        operation: input.operation,
        options: input.options,
        input_asset_ids: input.inputAssetIds,
        output_asset_ids: [],
        status: "queued",
      })
      .select("*")
      .single() as DatabaseResult<StudioVisionJob>;
    const job = databaseResult(result);
    if (!job) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return job;
  }

  async updateProjectQuota(input: {
    projectId: string;
    freeQuotaModels: string[];
    freeQuotaConfirmedAt: Record<string, string>;
  }): Promise<StudioProject | null> {
    const result = await this.client
      .from("creative_studio_projects")
      .update({
        free_quota_models: input.freeQuotaModels,
        free_quota_confirmed_at: input.freeQuotaConfirmedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.projectId)
      .eq("owner_user_id", this.owner.userId)
      .select("*")
      .maybeSingle() as DatabaseResult<StudioProject>;
    return databaseResult(result);
  }

  async createAsset(input: {
    id: string;
    projectId: string;
    kind: StudioAsset["kind"];
    name: string;
    mimeType: string;
    objectPath: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    durationSeconds?: number | null;
    sha256: string;
    provenance?: Record<string, unknown>;
  }): Promise<StudioAsset> {
    const result = await this.client
      .from("creative_studio_assets")
      .insert({
        id: input.id,
        project_id: input.projectId,
        owner_user_id: this.owner.userId,
        kind: input.kind,
        name: input.name,
        mime_type: input.mimeType,
        object_path: input.objectPath,
        byte_size: input.byteSize,
        width: input.width,
        height: input.height,
        duration_seconds: input.durationSeconds ?? null,
        sha256: input.sha256,
        provenance: input.provenance ?? {},
      })
      .select("*")
      .single() as DatabaseResult<StudioAsset>;
    const asset = databaseResult(result);
    if (!asset) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return asset;
  }

  async listModelAcknowledgements(): Promise<StudioModelAcknowledgement[]> {
    const result = await this.client
      .from("creative_studio_model_acknowledgements")
      .select("*")
      .eq("owner_user_id", this.owner.userId)
      .order("billing_acknowledged_at", { ascending: false }) as DatabaseResult<StudioModelAcknowledgement[]>;
    return databaseResult(result) ?? [];
  }

  async acknowledgeModel(input: { modelId: string; contractVersion: string }): Promise<StudioModelAcknowledgement> {
    const result = await this.client
      .from("creative_studio_model_acknowledgements")
      .upsert({
        owner_user_id: this.owner.userId,
        model_id: input.modelId,
        contract_version: input.contractVersion,
        acknowledgement_text_version: "alibaba-billing-v1",
        billing_acknowledged_at: new Date().toISOString(),
      }, { onConflict: "owner_user_id,model_id,contract_version" })
      .select("*")
      .single() as DatabaseResult<StudioModelAcknowledgement>;
    const acknowledgement = databaseResult(result);
    if (!acknowledgement) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return acknowledgement;
  }

  async getAsset(assetId: string): Promise<StudioAsset | null> {
    const result = await this.client
      .from("creative_studio_assets")
      .select("*")
      .eq("id", assetId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as DatabaseResult<StudioAsset>;
    return databaseResult(result);
  }

  async getVisionJob(jobId: string): Promise<StudioVisionJob | null> {
    const result = await this.client
      .from("creative_studio_vision_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as DatabaseResult<StudioVisionJob>;
    return databaseResult(result);
  }

  async listAssets(projectId: string): Promise<StudioAsset[]> {
    const result = await this.client
      .from("creative_studio_assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .order("created_at", { ascending: false }) as DatabaseResult<StudioAsset[]>;
    return databaseResult(result) ?? [];
  }

  async findJobByIdempotency(projectId: string, idempotencyKey: string): Promise<StudioJob | null> {
    const result = await this.client
      .from("creative_studio_jobs")
      .select("*")
      .eq("project_id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle() as DatabaseResult<StudioJob>;
    return databaseResult(result);
  }

  async createJob(input: {
    id: string;
    projectId: string;
    idempotencyKey: string;
    fingerprint: string;
    modelId: string;
    task?: VideoTask;
    initialStatus?: StudioJobStatus;
    prompt: string;
    inputAssets: StudioJob["input_assets"];
    options: StudioJob["options"];
  }): Promise<StudioJob> {
    const result = await this.client
      .from("creative_studio_jobs")
      .insert({
        id: input.id,
        project_id: input.projectId,
        owner_user_id: this.owner.userId,
        idempotency_key: input.idempotencyKey,
        fingerprint: input.fingerprint,
        model_id: input.modelId,
        task: input.task ?? "image-to-video",
        prompt: input.prompt,
        input_assets: input.inputAssets,
        options: input.options,
        status: input.initialStatus ?? "queued",
      })
      .select("*")
      .single() as DatabaseResult<StudioJob>;
    const job = databaseResult(result);
    if (!job) {
      throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    }
    return job;
  }

  async createJobMedia(input: { jobId: string; assetId: string; role: MediaRole; ordinal: number }) {
    const asset = await this.getAsset(input.assetId);
    if (!asset) throw new StudioError(400, "invalid_generation_asset", "Generation media must be owned by this Studio account.");
    const result = await this.client
      .from("creative_studio_job_media")
      .insert({
        job_id: input.jobId,
        asset_id: input.assetId,
        owner_user_id: this.owner.userId,
        role: input.role,
        ordinal: input.ordinal,
      })
      .select("*")
      .single() as DatabaseResult<{ id: string }>;
    const media = databaseResult(result);
    if (!media) throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
    return media;
  }

  async getJob(jobId: string): Promise<StudioJob | null> {
    const result = await this.client
      .from("creative_studio_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as DatabaseResult<StudioJob>;
    return databaseResult(result);
  }

  async listJobs(projectId: string): Promise<StudioJob[]> {
    const result = await this.client
      .from("creative_studio_jobs")
      .select("*")
      .eq("project_id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .order("created_at", { ascending: false }) as DatabaseResult<StudioJob[]>;
    return databaseResult(result) ?? [];
  }

  async transitionJob(
    jobId: string,
    expectedStatus: StudioJobStatus,
    patch: Partial<{
      status: StudioJobStatus;
      providerTaskId: string | null;
      outputAssetId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>,
  ): Promise<StudioJob | null> {
    const result = await this.client
      .from("creative_studio_jobs")
      .update({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.providerTaskId !== undefined ? { provider_task_id: patch.providerTaskId } : {}),
        ...(patch.outputAssetId !== undefined ? { output_asset_id: patch.outputAssetId } : {}),
        ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
        ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("owner_user_id", this.owner.userId)
      .eq("status", expectedStatus)
      .select("*")
      .maybeSingle() as DatabaseResult<StudioJob>;
    return databaseResult(result);
  }

  async updateJob(
    jobId: string,
    patch: Partial<{
      status: StudioJobStatus;
      providerTaskId: string | null;
      outputAssetId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>,
  ): Promise<StudioJob | null> {
    const result = await this.client
      .from("creative_studio_jobs")
      .update({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.providerTaskId !== undefined ? { provider_task_id: patch.providerTaskId } : {}),
        ...(patch.outputAssetId !== undefined ? { output_asset_id: patch.outputAssetId } : {}),
        ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
        ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("owner_user_id", this.owner.userId)
      .select("*")
      .maybeSingle() as DatabaseResult<StudioJob>;
    return databaseResult(result);
  }
}
