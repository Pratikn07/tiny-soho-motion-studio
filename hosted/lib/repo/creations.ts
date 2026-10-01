import {
  ACTIVE_PIPELINE_RUN_STATUSES,
  type CreationDocumentV2,
  type CreationSummary,
  type CreationView,
  type LayerAssetKind,
} from "@/lib/contract";
import { requireOwner } from "@/lib/auth";
import { readCreationDocument } from "@/lib/creations";
import { StudioError } from "@/lib/errors";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import type { Owner } from "@/lib/types";

type DataClient = { from: (table: string) => any };
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

type ProjectRow = {
  id: string;
  name: string;
  updated_at: string;
  carousel_document: unknown;
  carousel_revision: number | null;
};

export type LayerAssetRow = {
  id: string;
  project_id: string;
  owner_user_id: string;
  kind: string;
  name: string;
  mime_type: string;
  object_path: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  sha256: string;
};

const unavailable = () => new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");

const value = <T>(result: Result<T>) => {
  if (result.error) throw unavailable();
  return result.data;
};

const view = (project: ProjectRow, document: CreationDocumentV2): CreationView => ({
  id: project.id,
  revision: project.carousel_revision ?? 0,
  document,
});

/** Creation v2 projects: `creative_studio_projects` rows whose `carousel_document.version` is 2. */
export class CreationsRepository {
  constructor(
    private readonly client: DataClient,
    private readonly owner: Owner,
  ) {}

  async listCreations(): Promise<CreationSummary[]> {
    const projects = value(await this.client
      .from("creative_studio_projects")
      .select("id,name,updated_at,carousel_document,carousel_revision")
      .eq("owner_user_id", this.owner.userId)
      .eq("carousel_document->>version", "2")
      .order("updated_at", { ascending: false }) as Result<ProjectRow[]>) ?? [];
    const runs = value(await this.client
      .from("creative_studio_pipeline_runs")
      .select("project_id,slide_id")
      .eq("owner_user_id", this.owner.userId)
      .in("status", [...ACTIVE_PIPELINE_RUN_STATUSES]) as Result<Array<{ project_id: string; slide_id: string }>>) ?? [];
    return projects.flatMap((project) => {
      const document = readCreationDocument(project.carousel_document);
      if (!document) return [];
      const inProgress = new Set(runs.filter((run) => run.project_id === project.id).map((run) => run.slide_id));
      const first = [...document.slides].sort((a, b) => a.order - b.order)[0];
      return [{
        id: project.id,
        name: document.name,
        updatedAt: new Date(project.updated_at).toISOString(),
        slideCount: document.slides.length,
        slidesInProgress: inProgress.size,
        coverAssetId: first?.layers.backgroundAssetId ?? null,
      }];
    });
  }

  async createCreation(document: CreationDocumentV2): Promise<CreationView> {
    const project = value(await this.client
      .from("creative_studio_projects")
      .insert({
        owner_user_id: this.owner.userId,
        name: document.name,
        carousel_document: document,
        carousel_revision: 0,
      })
      .select("id,name,updated_at,carousel_document,carousel_revision")
      .single() as Result<ProjectRow>);
    if (!project) throw unavailable();
    return view(project, document);
  }

  async getCreation(projectId: string): Promise<CreationView | null> {
    const project = value(await this.client
      .from("creative_studio_projects")
      .select("id,name,updated_at,carousel_document,carousel_revision")
      .eq("id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as Result<ProjectRow>);
    const document = project ? readCreationDocument(project.carousel_document) : null;
    return project && document ? view(project, document) : null;
  }

  async requireCreation(projectId: string): Promise<CreationView> {
    const creation = await this.getCreation(projectId);
    if (!creation) throw new StudioError(404, "project_not_found", "Creation was not found.");
    return creation;
  }

  /** Optimistic save: 409 `carousel_revision_conflict` when another tab saved first. */
  async saveCreation(projectId: string, revision: number, document: CreationDocumentV2): Promise<CreationView> {
    const project = value(await this.client
      .from("creative_studio_projects")
      .update({
        name: document.name,
        carousel_document: document,
        carousel_revision: revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("owner_user_id", this.owner.userId)
      .eq("carousel_revision", revision)
      .select("id,name,updated_at,carousel_document,carousel_revision")
      .maybeSingle() as Result<ProjectRow>);
    if (!project) {
      throw new StudioError(
        409,
        "carousel_revision_conflict",
        "This creation changed in another tab. Reopen it before saving.",
      );
    }
    return view(project, document);
  }

  async getAsset(assetId: string): Promise<LayerAssetRow | null> {
    return value(await this.client
      .from("creative_studio_assets")
      .select("id,project_id,owner_user_id,kind,name,mime_type,object_path,byte_size,width,height,sha256")
      .eq("id", assetId)
      .eq("owner_user_id", this.owner.userId)
      .maybeSingle() as Result<LayerAssetRow>);
  }

  /** Idempotent on the asset id: a retried finalise returns the row it already wrote. */
  async insertLayerAsset(input: {
    id: string;
    projectId: string;
    kind: LayerAssetKind;
    name: string;
    mimeType: string;
    objectPath: string;
    byteSize: number;
    width: number;
    height: number;
    sha256: string;
  }): Promise<LayerAssetRow> {
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
        provenance: { source: "creation-layer-upload" },
      })
      .select("id,project_id,owner_user_id,kind,name,mime_type,object_path,byte_size,width,height,sha256")
      .single() as Result<LayerAssetRow>;
    if (!inserted.error && inserted.data) return inserted.data;
    if (inserted.error?.code === "23505") {
      const existing = await this.getAsset(input.id);
      if (existing?.object_path === input.objectPath) return existing;
      throw new StudioError(409, "asset_conflict", "This layer ID belongs to another upload.");
    }
    throw unavailable();
  }
}

/** Owner check plus a service-role client and repository for one creation request. */
export async function openCreations(request: Request) {
  const owner = await requireOwner(request);
  const client = createServiceSupabaseClient();
  return { owner, client, repo: new CreationsRepository(client, owner) };
}
