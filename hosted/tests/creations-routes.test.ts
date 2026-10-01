import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getCreation, PUT as saveCreation } from "@/app/api/creations/[id]/route";
import { POST as finaliseLayersPost, PUT as finaliseLayers } from "@/app/api/creations/[id]/slides/[slideId]/layers/route";
import { GET as listCreations, POST as createCreation } from "@/app/api/creations/route";
import { requireOwner } from "@/lib/auth";
import {
  creationListResponseSchema,
  creationViewSchema,
  layerFinaliseResponseSchema,
  layerUploadResponseSchema,
  type CreationView,
} from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import { creationsFakeSupabase } from "./creations-fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./creations-fake-supabase").creationsFakeSupabase> | null }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: () => fake.current!.client }));

const owners: Record<string, { userId: string; email: string }> = {
  "Bearer owner": { userId: "00000000-0000-4000-8000-00000000000a", email: "owner@test" },
  "Bearer other": { userId: "00000000-0000-4000-8000-00000000000b", email: "other@test" },
};

const call = (method: string, body?: unknown, as = "owner") => new Request("https://studio.test/api/creations", {
  method,
  headers: { Authorization: `Bearer ${as}`, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (id: string, slideId?: string) => ({ params: Promise.resolve(slideId ? { id, slideId } : { id }) }) as never;

const png = (width: number, height: number, alpha = 1) => sharp({
  create: { width, height, channels: 4, background: { r: 200, g: 180, b: 160, alpha } },
}).png().toBuffer();
const jpeg = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: { r: 200, g: 180, b: 160 } },
}).jpeg().toBuffer();

const slideId = "0b9e7c52-1d3a-4f6b-8a2c-7e5d4c3b2a10";
const secondSlideId = "1c8f6d43-2e4b-4a7c-9b3d-8f6e5d4c3b21";
const emptySlide = (id: string, order: number) => ({
  id, name: `slide ${order + 1}`, order, width: null, height: null, layers: { backgroundAssetId: null, textAssetId: null },
});

async function newCreationWithSlides(): Promise<CreationView> {
  const created = creationViewSchema.parse(await (await createCreation(call("POST", { name: "Potty words" }))).json());
  const document = { ...created.document, slides: [emptySlide(slideId, 0), emptySlide(secondSlideId, 1)] };
  const saved = await saveCreation(call("PUT", { revision: created.revision, document }), params(created.id));
  expect(saved.status).toBe(200);
  return creationViewSchema.parse(await saved.json());
}

async function uploadLayers(
  creation: CreationView,
  files: { background: [Buffer, string]; text?: [Buffer, string] },
  slide = slideId,
) {
  const background = crypto.randomUUID();
  const text = files.text ? crypto.randomUUID() : undefined;
  const requested = await finaliseLayersPost(call("POST", {
    background: { assetId: background, fileName: "potty-background", mime: files.background[1], size: files.background[0].length },
    ...(files.text ? { text: { assetId: text, fileName: "potty-text.png", mime: files.text[1], size: files.text[0].length } } : {}),
  }), params(creation.id, slide));
  return { requested, background, text };
}

beforeEach(() => {
  fake.current = creationsFakeSupabase();
  vi.mocked(requireOwner).mockImplementation(async (request: Request) => {
    const owner = owners[request.headers.get("authorization") ?? ""];
    if (!owner) throw new StudioError(401, "invalid_token", "Authentication is required.");
    return owner;
  });
});

describe("creations", () => {
  it("creates, lists and reads a v2 creation", async () => {
    const created = await createCreation(call("POST", { name: "Potty words" }));
    expect(created.status).toBe(201);
    const creation = creationViewSchema.parse(await created.json());
    expect(creation.document).toMatchObject({ version: 2, defaults: { modelId: "ltx-2.5-distilled", motionStyle: "calm" } });

    fake.current!.tables.creative_studio_projects.push({
      id: crypto.randomUUID(), owner_user_id: owners["Bearer owner"].userId, name: "Legacy",
      carousel_document: { name: "Legacy", slides: [] }, carousel_revision: 0, updated_at: new Date().toISOString(),
    });
    const list = creationListResponseSchema.parse(await (await listCreations(call("GET"))).json());
    expect(list.creations.map((item) => item.id)).toEqual([creation.id]);

    const read = await getCreation(call("GET"), params(creation.id));
    expect(creationViewSchema.parse(await read.json())).toEqual(creation);
  });

  it("returns 409 when saving an old revision", async () => {
    const creation = await newCreationWithSlides();
    const stale = await saveCreation(call("PUT", { revision: creation.revision - 1, document: creation.document }), params(creation.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("carousel_revision_conflict");
  });

  it("hides another owner's creation", async () => {
    const creation = await newCreationWithSlides();
    const read = await getCreation(call("GET", undefined, "other"), params(creation.id));
    expect(read.status).toBe(404);
    const upload = await finaliseLayersPost(call("POST", {
      background: { assetId: crypto.randomUUID(), fileName: "bg.png", mime: "image/png", size: 10 },
    }, "other"), params(creation.id, slideId));
    expect(upload.status).toBe(404);
  });

  it("rejects a saved document pointing at layers that were never uploaded", async () => {
    const creation = await newCreationWithSlides();
    const document = structuredClone(creation.document);
    Object.assign(document.slides[0], { width: 40, height: 50, layers: { backgroundAssetId: crypto.randomUUID(), textAssetId: null } });
    const saved = await saveCreation(call("PUT", { revision: creation.revision, document }), params(creation.id));
    expect(saved.status).toBe(400);
    expect((await saved.json()).error.code).toBe("layers_invalid");
  });
});

describe("layered upload", () => {
  it("uploads both layers, records their kinds and sizes, and fills the slide", async () => {
    const creation = await newCreationWithSlides();
    const { requested, background, text } = await uploadLayers(creation, {
      background: [await png(40, 50), "image/webp"],
      text: [await png(40, 50, 0.5), "image/png"],
    });
    const uploads = layerUploadResponseSchema.parse(await requested.json()).uploads;
    const owner = owners["Bearer owner"].userId;
    const folder = `owners/${owner}/projects/${creation.id}/slides/${slideId}`;
    expect(fake.current!.uploadTo(uploads.background.signedUrl, await sharp(await png(40, 50)).webp().toBuffer(), "image/webp"))
      .toBe(`${folder}/background-${background}.webp`);
    expect(fake.current!.uploadTo(uploads.text!.signedUrl, await png(40, 50, 0.5), "image/png")).toBe(`${folder}/text-${text}.png`);

    const finalised = await finaliseLayers(call("PUT", {
      revision: creation.revision, background: { assetId: background }, text: { assetId: text },
    }), params(creation.id, slideId));
    expect(finalised.status).toBe(200);
    const body = layerFinaliseResponseSchema.parse(await finalised.json());
    expect(body.checks).toMatchObject({ ok: true, items: [], textLayer: { lines: 1 } });
    expect(body.creation.revision).toBe(creation.revision + 1);
    expect(body.creation.document.slides[0]).toMatchObject({
      width: 40, height: 50, layers: { backgroundAssetId: background, textAssetId: text }, checks: { ok: true },
    });

    const assets = fake.current!.tables.creative_studio_assets;
    expect(assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: background, kind: "background-image", mime_type: "image/webp", owner_user_id: owner, width: 40, height: 50 }),
      expect.objectContaining({ id: text, kind: "text-layer", mime_type: "image/png", owner_user_id: owner, width: 40, height: 50 }),
    ]));
  });

  it("returns the same result for a repeated finalise without a second asset or revision", async () => {
    const creation = await newCreationWithSlides();
    const { requested, background } = await uploadLayers(creation, { background: [await png(40, 50), "image/png"] });
    const uploads = layerUploadResponseSchema.parse(await requested.json()).uploads;
    fake.current!.uploadTo(uploads.background.signedUrl, await png(40, 50), "image/png");
    const body = { revision: creation.revision, background: { assetId: background } };

    const first = layerFinaliseResponseSchema.parse(await (await finaliseLayers(call("PUT", body), params(creation.id, slideId))).json());
    const again = await finaliseLayers(call("PUT", body), params(creation.id, slideId));
    expect(again.status).toBe(200);
    expect(layerFinaliseResponseSchema.parse(await again.json())).toEqual(first);
    expect(fake.current!.tables.creative_studio_assets).toHaveLength(1);
    const retriedPost = await uploadLayers(first.creation, { background: [await png(40, 50), "image/png"] });
    expect(retriedPost.requested.status).toBe(200);
  });

  it("rejects a JPEG text layer before it is uploaded", async () => {
    const creation = await newCreationWithSlides();
    const { requested } = await uploadLayers(creation, {
      background: [await png(40, 50), "image/png"],
      text: [await jpeg(40, 50), "image/jpeg"],
    });
    expect(requested.status).toBe(400);
    expect((await requested.json()).error.code).toBe("invalid_request");
  });

  it("stores mismatched layers but reports size_mismatch", async () => {
    const creation = await newCreationWithSlides();
    const { requested, background, text } = await uploadLayers(creation, {
      background: [await png(40, 50), "image/png"],
      text: [await png(40, 40, 0.5), "image/png"],
    });
    const uploads = layerUploadResponseSchema.parse(await requested.json()).uploads;
    fake.current!.uploadTo(uploads.background.signedUrl, await png(40, 50), "image/png");
    fake.current!.uploadTo(uploads.text!.signedUrl, await png(40, 40, 0.5), "image/png");

    const finalised = await finaliseLayers(call("PUT", {
      revision: creation.revision, background: { assetId: background }, text: { assetId: text },
    }), params(creation.id, slideId));
    const body = layerFinaliseResponseSchema.parse(await finalised.json());
    expect(body.checks.ok).toBe(false);
    expect(body.checks.items).toEqual([expect.objectContaining({ code: "size_mismatch", severity: "error" })]);
    expect(body.checks.items[0].message).toContain("40×40");
  });

  it("allows a slide without a text layer and needs the upload before finalising", async () => {
    const creation = await newCreationWithSlides();
    const { background } = await uploadLayers(creation, { background: [await png(40, 50), "image/png"] }, secondSlideId);
    const early = await finaliseLayers(call("PUT", { revision: creation.revision, background: { assetId: background }, text: null }),
      params(creation.id, secondSlideId));
    expect(early.status).toBe(400);
    expect((await early.json()).error.code).toBe("layers_missing");
  });

  it("drops a stale AI review when a layer is replaced", async () => {
    const creation = await newCreationWithSlides();
    const first = await uploadLayers(creation, { background: [await png(40, 50), "image/png"] });
    fake.current!.uploadTo(layerUploadResponseSchema.parse(await first.requested.json()).uploads.background.signedUrl, await png(40, 50), "image/png");
    const done = layerFinaliseResponseSchema.parse(await (await finaliseLayers(call("PUT", {
      revision: creation.revision, background: { assetId: first.background },
    }), params(creation.id, slideId))).json());
    const reviewed = structuredClone(done.creation.document);
    reviewed.slides[0].reviewRunId = "9d1a9e7a-9fbc-4be2-8cae-5adfcebdac98";
    const saved = creationViewSchema.parse(await (await saveCreation(call("PUT", { revision: done.creation.revision, document: reviewed }), params(creation.id))).json());

    const second = await uploadLayers(saved, { background: [await png(40, 50), "image/png"] });
    fake.current!.uploadTo(layerUploadResponseSchema.parse(await second.requested.json()).uploads.background.signedUrl, await png(40, 50), "image/png");
    const replaced = layerFinaliseResponseSchema.parse(await (await finaliseLayers(call("PUT", {
      revision: saved.revision, background: { assetId: second.background },
    }), params(creation.id, slideId))).json());
    expect(replaced.creation.document.slides[0].reviewRunId).toBeUndefined();
    expect(replaced.creation.document.slides[0].layers.backgroundAssetId).toBe(second.background);
  });
});
