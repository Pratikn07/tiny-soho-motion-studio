import type { DirectionResult, DirectionRunStatus } from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import type { Owner } from "@/lib/types";

type DataClient = { from: (table: string) => any };
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

export type DirectionRunRow = {
  id: string;
  owner_user_id: string;
  project_id: string;
  idempotency_key: string;
  slides: Array<{ slideId: string; finishedAssetId: string }>;
  status: DirectionRunStatus;
  routine_session_id: string | null;
  routine_session_url: string | null;
  fired_at: string | null;
  completed_at: string | null;
  result: (DirectionResult & { finalised?: Record<string, unknown> }) | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  project_id: string;
  kind: string;
  mime_type: string;
  object_path: string;
  width: number | null;
  height: number | null;
};

const COLUMNS = "id,owner_user_id,project_id,idempotency_key,slides,status,routine_session_id,routine_session_url,"
  + "fired_at,completed_at,result,error_code,created_at,updated_at";
const unavailable = () => new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");

/** `creative_studio_direction_runs` and the assets a direction run creates, scoped to one owner. */
export class DirectionRepository {
  constructor(
    private readonly client: DataClient,
    private readonly owner: Owner,
  ) {}

  /** Inserts a queued run, or returns the existing one for the same idempotency key. */
  async createRun(input: {
    id: string;
    projectId: string;
    idempotencyKey: string;
    slides: Array<{ slideId: string; finishedAssetId: string }>;
  }): Promise<{ run: DirectionRunRow; created: boolean }> {
    const inserted = await this.client
      .from("creative_studio_direction_runs")
      .insert({
        id: input.id,
        owner_user_id: this.owner.userId,
        project_id: input.projectId,
        idempotency_key: input.idempotencyKey,
        slides: input.slides,
        status: "queued",
      })
      .select(COLUMNS)
      .single() as Result<DirectionRunRow>;
    if (!inserted.error && inserted.data) return { run: inserted.data, created: true };
    if (inserted.error?.code === "23505") {
      const existing = await this.client
        .from("creative_studio_direction_runs")
        .select(COLUMNS)
        .eq("project_id", input.projectId)
        .eq("idempotency_key", input.idempotencyKey)
        .eq("owner_user_id", this.owner.userId)
        .maybeSingle() as Result<DirectionRunRow>;
      if (existing.data) return { run: existing.data, created: false };
    }
    throw unavailable();
  }

  async getRun(projectId: string, runId: string): Promise<DirectionRunRow | null> {
    const found = await this.client
      .from("creative_studio_direction_runs")
      .select(COLUMNS)
      .eq("id", runId)
      .eq("project_id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as Result<DirectionRunRow>;
    if (found.error) throw unavailable();
    return found.data;
  }

  async updateRun(runId: string, patch: Partial<Omit<DirectionRunRow, "id" | "owner_user_id" | "project_id">>) {
    const updated = await this.client
      .from("creative_studio_direction_runs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("owner_user_id", this.owner.userId)
      .select(COLUMNS)
      .single() as Result<DirectionRunRow>;
    if (updated.error || !updated.data) throw unavailable();
    return updated.data;
  }

  async getAsset(assetId: string): Promise<AssetRow | null> {
    const found = await this.client
      .from("creative_studio_assets")
      .select("id,project_id,kind,mime_type,object_path,width,height")
      .eq("id", assetId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as Result<AssetRow>;
    if (found.error) throw unavailable();
    return found.data;
  }

  /** Records an asset once; a retry with the same id and path returns the existing row. */
  async insertAsset(input: {
    id: string;
    projectId: string;
    kind: "source-image" | "background-image" | "text-layer" | "derived-video";
    name: string;
    mimeType: string;
    objectPath: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    sha256: string;
    provenance: Record<string, unknown>;
  }): Promise<AssetRow> {
    const inserted = await this.client
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
        duration_seconds: null,
        sha256: input.sha256,
        provenance: input.provenance,
      })
      .select("id,project_id,kind,mime_type,object_path,width,height")
      .single() as Result<AssetRow>;
    if (!inserted.error && inserted.data) return inserted.data;
    if (inserted.error?.code === "23505") {
      const existing = await this.getAsset(input.id);
      if (existing?.object_path === input.objectPath) return existing;
      throw new StudioError(409, "asset_conflict", "This asset ID belongs to another upload.");
    }
    throw unavailable();
  }
}
