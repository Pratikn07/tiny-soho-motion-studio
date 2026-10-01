import {
  creationListResponseSchema,
  creationViewSchema,
  layerFinaliseResponseSchema,
  layerUploadResponseSchema,
  type CreationDocumentV2,
  type CreationSummary,
  type CreationView,
  type LayerFinaliseRequest,
  type LayerFinaliseResponse,
  type LayerUploadRequest,
  type LayerUploadResponse,
} from "@/lib/contract";

/** Everything the creation screens ask of the server. The in-memory mock for tests and previews is in mock-api.ts. */
export interface CreationApi {
  listCreations(): Promise<CreationSummary[]>;
  getCreation(id: string): Promise<CreationView>;
  createCreation(name: string): Promise<CreationView>;
  /** Throws `CreationApiError` with status 409 when `revision` is stale. */
  saveCreation(id: string, revision: number, document: CreationDocumentV2): Promise<CreationView>;
  requestLayerUploads(id: string, slideId: string, request: LayerUploadRequest): Promise<LayerUploadResponse>;
  uploadFile(signedUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void>;
  finaliseLayers(id: string, slideId: string, request: LayerFinaliseRequest): Promise<LayerFinaliseResponse>;
  /** A signed URL (300 s) for an asset this owner holds. */
  assetUrl(assetId: string): Promise<string>;
}

export class CreationApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const isConflict = (error: unknown) => error instanceof CreationApiError && error.status === 409
  && error.code === "carousel_revision_conflict";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Puts a file to a signed upload URL, reporting progress. Uses XMLHttpRequest because fetch has no upload events. */
export function xhrUpload(signedUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", signedUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else reject(new CreationApiError(request.status, "upload_failed", "The file didn't upload. Try again."));
    };
    request.onerror = () => reject(new CreationApiError(0, "upload_failed", "The connection dropped while uploading. Try again."));
    request.send(file);
  });
}

export function createCreationApi(options: {
  getAccessToken: () => Promise<string | null>;
  fetcher?: Fetcher;
  upload?: CreationApi["uploadFile"];
}): CreationApi {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const token = await options.getAccessToken();
    if (!token) throw new CreationApiError(401, "unauthorized", "Sign in to use the Studio.");
    let response: Response;
    try {
      response = await fetcher(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      });
    } catch {
      throw new CreationApiError(0, "network", "The Studio can't be reached. Check your connection and try again.");
    }
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw new CreationApiError(response.status, body.error?.code ?? "request_failed",
        body.error?.message ?? "The Studio couldn't do that. Try again.");
    }
    return body;
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
  const slidePath = (id: string, slideId: string) => `/api/creations/${id}/slides/${slideId}/layers`;
  return {
    async listCreations() {
      return creationListResponseSchema.parse(await request("/api/creations")).creations;
    },
    async getCreation(id) {
      return creationViewSchema.parse(await request(`/api/creations/${id}`));
    },
    async createCreation(name) {
      return creationViewSchema.parse(await request("/api/creations", json("POST", { name })));
    },
    async saveCreation(id, revision, document) {
      return creationViewSchema.parse(await request(`/api/creations/${id}`, json("PUT", { revision, document })));
    },
    async requestLayerUploads(id, slideId, upload) {
      return layerUploadResponseSchema.parse(await request(slidePath(id, slideId), json("POST", upload)));
    },
    uploadFile: options.upload ?? xhrUpload,
    async finaliseLayers(id, slideId, finalise) {
      return layerFinaliseResponseSchema.parse(await request(slidePath(id, slideId), json("PUT", finalise)));
    },
    async assetUrl(assetId) {
      const body = await request(`/api/assets/${assetId}/download`) as { signedUrl?: unknown };
      if (typeof body.signedUrl !== "string") throw new CreationApiError(502, "asset_url", "The image couldn't be loaded.");
      return body.signedUrl;
    },
  };
}
