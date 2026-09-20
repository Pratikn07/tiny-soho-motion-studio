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
      const body = await request<{ projects: StudioProjectView[] }>("/api/projects");
      return body.projects;
    },
    async createProject(input: { name: string; canvas: string }): Promise<StudioProjectView> {
      const body = await request<{ project: StudioProjectView }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.project;
    },
    async updateProjectQuota(projectId: string, input: { freeQuotaModels: string[]; freeQuotaConfirmedAt: Record<string, string> }): Promise<StudioProjectView> {
      const body = await request<{ project: StudioProjectView }>(`/api/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
      return body.project;
    },
    async listAssets(projectId: string): Promise<StudioAssetView[]> {
      const body = await request<{ assets: StudioAssetView[] }>(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
      return body.assets;
    },
    async uploadAsset(projectId: string, file: File): Promise<StudioAssetView> {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("file", file);
      const body = await request<{ asset: StudioAssetView }>("/api/assets", { method: "POST", body: formData });
      return body.asset;
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
