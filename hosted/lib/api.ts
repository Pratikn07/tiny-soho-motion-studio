import type {
  StudioAssetView,
  StudioJobView,
  StudioProjectView,
} from "@/components/MotionStudio";
import type { MediaRole, ModelAcknowledgement } from "@/lib/video-catalog";

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

type ApiAcknowledgement = {
  model_id: string;
  contract_version: string;
};

export type StudioDirectorRequestView = {
  id: string;
  projectId: string;
  brief: string;
  status: "queued" | "running" | "drafted" | "failed" | "needs_attention" | "canceled";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  proposalId?: string | null;
};

export type StudioDirectorProposalView = {
  id: string;
  requestId: string;
  projectId: string;
  snapshot: Record<string, unknown>;
  evidence: Record<string, unknown>;
  fingerprint: string;
  status: "drafted" | "approved" | "failed" | "canceled";
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioWorkflowView = {
  id: string;
  projectId: string | null;
  name: string;
  graphVersion: 2;
  graph: Record<string, unknown>;
  fingerprint: string;
  createdAt: string;
};

export type StudioWorkflowRunView = {
  id: string;
  workflowId: string;
  projectId: string;
  graphSnapshot: Record<string, unknown>;
  nodeState: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "needs_attention" | "canceled";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioVisionCapabilityView = {
  capabilityId: string;
  serviceVersion: string;
  status: "available" | "unavailable";
  reason: string | null;
  refreshedAt: string;
};

export type StudioVisionJobView = {
  id: string;
  projectId: string;
  sourceAssetId: string;
  operation: "inspect" | "overlay" | "plate" | "compose" | "ocr" | "segment" | "layers";
  status: "queued" | "running" | "completed" | "failed" | "needs_attention" | "canceled";
  outputAssetIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
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
    async listAcknowledgements(): Promise<ModelAcknowledgement[]> {
      const body = await request<{ acknowledgements: ApiAcknowledgement[] }>("/api/model-acknowledgements");
      return body.acknowledgements.map((acknowledgement) => ({
        modelId: acknowledgement.model_id,
        contractVersion: acknowledgement.contract_version,
      }));
    },
    async acknowledgeModel(input: { modelId: string; contractVersion: string }): Promise<ModelAcknowledgement> {
      const body = await request<{ acknowledgement: ApiAcknowledgement }>("/api/model-acknowledgements", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return {
        modelId: body.acknowledgement.model_id,
        contractVersion: body.acknowledgement.contract_version,
      };
    },
    async createJob(input: {
      projectId: string;
      idempotencyKey: string;
      modelId: string;
      prompt: string;
      media: Array<{ assetId: string; role: MediaRole; ordinal?: number }>;
      options: Record<string, unknown>;
    }): Promise<StudioJobView> {
      const body = await request<{ job: StudioJobView }>("/api/jobs", { method: "POST", body: JSON.stringify(input) });
      return body.job;
    },
    async listJobs(projectId: string): Promise<StudioJobView[]> {
      const body = await request<{ jobs: StudioJobView[] }>(`/api/jobs?projectId=${encodeURIComponent(projectId)}`);
      return body.jobs;
    },
    async getJob(jobId: string): Promise<StudioJobView> {
      const body = await request<{ job: StudioJobView }>(`/api/jobs/${jobId}`);
      return body.job;
    },
    async createDirectorDraft(input: {
      projectId: string;
      idempotencyKey: string;
      brief: string;
    }): Promise<StudioDirectorRequestView> {
      const body = await request<{ request: StudioDirectorRequestView }>("/api/director/drafts", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.request;
    },
    async getDirectorRequest(requestId: string): Promise<StudioDirectorRequestView> {
      const body = await request<{ request: StudioDirectorRequestView }>(`/api/director/requests/${requestId}`);
      return body.request;
    },
    async getDirectorProposal(proposalId: string): Promise<StudioDirectorProposalView> {
      const body = await request<{ proposal: StudioDirectorProposalView }>(`/api/director/proposals/${proposalId}`);
      return body.proposal;
    },
    async approveDirectorProposal(proposalId: string): Promise<StudioJobView[]> {
      const body = await request<{ jobs: StudioJobView[] }>(`/api/director/proposals/${proposalId}/approve`, { method: "POST" });
      return body.jobs;
    },
    async listWorkflows(projectId: string): Promise<StudioWorkflowView[]> {
      const body = await request<{ workflows: StudioWorkflowView[] }>(`/api/workflows?projectId=${encodeURIComponent(projectId)}`);
      return body.workflows;
    },
    async saveWorkflow(input: { projectId: string; name: string; graph: Record<string, unknown> }): Promise<StudioWorkflowView> {
      const body = await request<{ workflow: StudioWorkflowView }>("/api/workflows", { method: "POST", body: JSON.stringify(input) });
      return body.workflow;
    },
    async startWorkflowRun(workflowId: string, input: { projectId: string; idempotencyKey: string }): Promise<StudioWorkflowRunView> {
      const body = await request<{ run: StudioWorkflowRunView }>(`/api/workflows/${workflowId}/runs`, { method: "POST", body: JSON.stringify(input) });
      return body.run;
    },
    async getWorkflowRun(runId: string): Promise<StudioWorkflowRunView> {
      const body = await request<{ run: StudioWorkflowRunView }>(`/api/workflow-runs/${runId}`);
      return body.run;
    },
    async listVisionCapabilities(): Promise<StudioVisionCapabilityView[]> {
      const body = await request<{ capabilities: StudioVisionCapabilityView[] }>("/api/vision/capabilities");
      return body.capabilities;
    },
    async createVisionJob(input: {
      projectId: string;
      sourceAssetId: string;
      operation: StudioVisionJobView["operation"];
      options: Record<string, unknown>;
      inputAssetIds: string[];
      idempotencyKey: string;
    }): Promise<StudioVisionJobView> {
      const body = await request<{ job: StudioVisionJobView }>("/api/vision/jobs", { method: "POST", body: JSON.stringify(input) });
      return body.job;
    },
    async getVisionJob(jobId: string): Promise<StudioVisionJobView> {
      const body = await request<{ job: StudioVisionJobView }>(`/api/vision/jobs/${jobId}`);
      return body.job;
    },
  };
}
