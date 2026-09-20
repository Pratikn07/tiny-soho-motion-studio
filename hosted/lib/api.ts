import type {
  StudioAssetView,
  StudioJobView,
  StudioProjectView,
} from "@/components/MotionStudio";

type SessionClient = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token: string } | null } }>;
  };
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiError = {
  error?: { message?: string };
};

type ApiProject = {
  id: string;
  name: string;
  canvas: string;
  free_quota_models: string[];
  free_quota_confirmed_at: Record<string, string>;
};

type ApiAsset = {
  id: string;
  kind: StudioAssetView["kind"];
  name: string;
  mime_type: string;
};

const projectView = (project: ApiProject): StudioProjectView => ({
  id: project.id,
  name: project.name,
  canvas: project.canvas,
  freeQuotaModels: project.free_quota_models,
  freeQuotaConfirmedAt: project.free_quota_confirmed_at,
});

const assetView = (asset: ApiAsset): StudioAssetView => ({
  id: asset.id,
  kind: asset.kind,
  name: asset.name,
  mimeType: asset.mime_type,
});

export function createStudioApi(client: SessionClient, fetcher: Fetcher = fetch) {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("Sign in to use the Studio.");
    const response = await fetcher(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => ({})) as T & ApiError;
    if (!response.ok) throw new Error(body.error?.message || "Studio request failed.");
    return body;
  };

  return {
    async listProjects(): Promise<StudioProjectView[]> {
      const body = await request<{ projects: ApiProject[] }>("/api/projects");
      return body.projects.map(projectView);
    },
    async createProject(input: { name: string; canvas: string }): Promise<StudioProjectView> {
      const body = await request<{ project: ApiProject }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return projectView(body.project);
    },
    async updateProjectQuota(projectId: string, input: { freeQuotaModels: string[]; freeQuotaConfirmedAt: Record<string, string> }): Promise<StudioProjectView> {
      const body = await request<{ project: ApiProject }>(`/api/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
      return projectView(body.project);
    },
    async listAssets(projectId: string): Promise<StudioAssetView[]> {
      const body = await request<{ assets: ApiAsset[] }>(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
      return body.assets.map(assetView);
    },
    async uploadAsset(projectId: string, file: File): Promise<StudioAssetView> {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("file", file);
      const body = await request<{ asset: ApiAsset }>("/api/assets", { method: "POST", body: formData });
      return assetView(body.asset);
    },
    async createJob(input: {
      projectId: string;
      idempotencyKey: string;
      modelId: "wan2.7-i2v" | "wan3-video";
      prompt: string;
      media: Array<{ assetId: string; role: "start-image" | "end-image" }>;
      options: { duration: number; resolution: string; aspectRatio?: string };
    }): Promise<StudioJobView> {
      const body = await request<{ job: StudioJobView }>("/api/jobs", { method: "POST", body: JSON.stringify(input) });
      return body.job;
    },
    async getJob(jobId: string): Promise<StudioJobView> {
      const body = await request<{ job: StudioJobView }>(`/api/jobs/${jobId}`);
      return body.job;
    },
  };
}
