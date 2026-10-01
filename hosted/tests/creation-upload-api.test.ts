import { describe, expect, it, vi } from "vitest";

import { CreationApiError, createCreationApi, isConflict } from "@/components/creation/api";
import { contractFixtures } from "@/lib/contract/fixtures";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("creation API client", () => {
  it("sends the owner's token and parses replies with the T0 schemas", async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => reply(200, contractFixtures.creation));
    const api = createCreationApi({ getAccessToken: async () => "owner-token", fetcher });
    const creation = await api.getCreation(contractFixtures.creation.id);
    expect(creation.document.slides).toHaveLength(contractFixtures.creation.document.slides.length);
    const [path, init] = fetcher.mock.calls[0];
    expect(path).toBe(`/api/creations/${contractFixtures.creation.id}`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer owner-token");
  });

  it("sends layer uploads and finalising to the slide's layers endpoint", async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => reply(200,
      init?.method === "POST" ? contractFixtures.layerUploadResponse
        : { creation: contractFixtures.creation, checks: contractFixtures.uploadChecksPotty }));
    const api = createCreationApi({ getAccessToken: async () => "t", fetcher });
    await api.requestLayerUploads("c1", "s1", contractFixtures.layerUploadRequest);
    const finalised = await api.finaliseLayers("c1", "s1", contractFixtures.layerFinaliseRequest);
    expect(fetcher.mock.calls.map(([path, init]) => [init?.method, path])).toEqual([
      ["POST", "/api/creations/c1/slides/s1/layers"], ["PUT", "/api/creations/c1/slides/s1/layers"],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(contractFixtures.layerFinaliseRequest);
    expect(finalised.checks.items).toHaveLength(2);
  });

  it("turns error replies into typed errors, including revision conflicts", async () => {
    const fetcher = vi.fn(async () => reply(409, { error: { code: "carousel_revision_conflict", message: "Changed elsewhere." } }));
    const api = createCreationApi({ getAccessToken: async () => "t", fetcher });
    const error = await api.saveCreation("c1", 3, contractFixtures.creation.document).catch((caught) => caught);
    expect(error).toBeInstanceOf(CreationApiError);
    expect(isConflict(error)).toBe(true);
    expect(error.message).toBe("Changed elsewhere.");
  });

  it("refuses to call the server without a session, and reports a dropped connection plainly", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(createCreationApi({ getAccessToken: async () => null, fetcher }).listCreations())
      .rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(createCreationApi({ getAccessToken: async () => "t", fetcher }).listCreations())
      .rejects.toMatchObject({ code: "network", message: expect.stringContaining("can't be reached") });
  });

  it("uploads files with the injected uploader", async () => {
    const upload = vi.fn(async (_url: string, _file: File, onProgress: (fraction: number) => void) => onProgress(1));
    const api = createCreationApi({ getAccessToken: async () => "t", fetcher: vi.fn(), upload });
    const progress = vi.fn();
    await api.uploadFile("https://storage.test/upload", new File(["x"], "a-text.png", { type: "image/png" }), progress);
    expect(upload).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(1);
  });
});
