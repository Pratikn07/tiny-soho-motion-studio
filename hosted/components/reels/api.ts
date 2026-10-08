import { xhrUpload } from "@/components/creation/api";
import type { ReelAction, ReelSummary, ReelView } from "@/lib/reels";

/** How a reel starts: a pasted brief, a link to someone else's reel to learn from, or a topic. */
export type NewReelInput = { brief: string } | { reference: string } | { topic: string };

export type ReelsApi = {
  list(): Promise<ReelSummary[]>;
  create(input: NewReelInput): Promise<ReelView>;
  get(id: string): Promise<ReelView>;
  act(id: string, action: ReelAction): Promise<ReelView>;
  /** Images step: a one-time upload URL, the upload itself (with progress), then the check and record. */
  startImageUpload(id: string, input: { file: string; mime: string; size: number }): Promise<{ uploadId: string; uploadUrl: string }>;
  uploadImage(uploadUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void>;
  finishImageUpload(id: string, input: { file: string; uploadId: string }): Promise<ReelView>;
  removeImage(id: string, file: string): Promise<ReelView>;
};

/** The Reels API for the signed-in owner. Errors carry the server's plain-language message. */
export function createReelsApi(getAccessToken: () => Promise<string | null>): ReelsApi {
  const call = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const token = await getAccessToken();
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? "Reels are temporarily unavailable. Try again.");
    return body as T;
  };
  return {
    list: async () => (await call<{ reels: ReelSummary[] }>("/api/reels")).reels,
    create: (input) => call<ReelView>("/api/reels", { method: "POST", body: JSON.stringify(input) }),
    get: (id) => call<ReelView>(`/api/reels/${id}`),
    act: (id, action) => call<ReelView>(`/api/reels/${id}/actions`, { method: "POST", body: JSON.stringify(action) }),
    startImageUpload: (id, input) => call(`/api/reels/${id}/images`, { method: "POST", body: JSON.stringify(input) }),
    uploadImage: (uploadUrl, file, onProgress) => xhrUpload(uploadUrl, file, onProgress),
    finishImageUpload: (id, input) => call<ReelView>(`/api/reels/${id}/images`, { method: "PUT", body: JSON.stringify(input) }),
    removeImage: (id, file) => call<ReelView>(`/api/reels/${id}/images?file=${encodeURIComponent(file)}`, { method: "DELETE" }),
  };
}
