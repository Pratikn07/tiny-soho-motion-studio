import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as acknowledge } from "@/app/api/catalog/acknowledgements/route";
import { GET } from "@/app/api/catalog/route";
import { requireOwner } from "@/lib/auth";
import { fitForSlide } from "@/lib/catalog/fit";
import { ALIBABA_CONTRACT_IDS, CATALOG_MODELS, getCatalogModel } from "@/lib/catalog/models";
import { catalogView } from "@/lib/catalog/view";
import {
  billingAcknowledgementResponseSchema,
  catalogModelSchema,
  catalogResponseSchema,
  type SlideV2,
} from "@/lib/contract";
import { contractFixtures } from "@/lib/contract/fixtures";
import catalogFixture from "@/lib/contract/fixtures/catalog.json";
import { getVideoModelContract } from "@/lib/video-catalog";
import { MODEL_CLIP_USD, MODEL_PROVIDERS } from "../../creative-worker/src/router";

const repo = vi.hoisted(() => ({
  getProject: vi.fn(),
  listModelAcknowledgements: vi.fn(),
  acknowledgeModel: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/repository", () => ({
  StudioRepository: class {
    constructor() {
      Object.assign(this, repo);
    }
  },
}));

const creation = contractFixtures.creation;
const potty = creation.document.slides[0];
const legacyAlibabaAck = { model_id: "wan2.7-i2v", contract_version: getVideoModelContract("wan2.7-i2v")!.contractVersion };
const modalAck = { model_id: "provider:modal-ltx", contract_version: "modal-billing-v1" };
const get = (query = "") => GET(new Request(`https://studio.test/api/catalog${query}`, { headers: { Authorization: "Bearer t" } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner", email: "owner@test" });
  repo.listModelAcknowledgements.mockResolvedValue([]);
  repo.getProject.mockResolvedValue({ id: creation.id, carousel_document: creation.document });
});

describe("catalog entries", () => {
  it("are valid contract models with one LTX default", () => {
    for (const model of CATALOG_MODELS) expect(catalogModelSchema.safeParse(model).success).toBe(true);
    expect(CATALOG_MODELS.map((model) => model.id)).toEqual(["ltx-2.5-distilled", "wan2.7-i2v", "wan3-i2v"]);
    expect(getCatalogModel("ltx-2.5-distilled")).toMatchObject({ provider: "modal-ltx", supports: { endFrame: true } });
  });

  it("points every Alibaba model at an existing request contract", () => {
    for (const model of CATALOG_MODELS.filter((entry) => entry.provider === "alibaba")) {
      const contract = getVideoModelContract(ALIBABA_CONTRACT_IDS[model.id]);
      expect(contract, model.id).not.toBeNull();
      expect(contract!.providerModel).toBe(model.providerModel);
      expect(contract!.task).toBe("image-to-video");
    }
  });

  it("routes each model to the same provider in the worker", () => {
    expect(MODEL_PROVIDERS).toEqual(Object.fromEntries(CATALOG_MODELS.map((model) => [model.id, model.provider])));
    expect(MODEL_CLIP_USD).toEqual(Object.fromEntries(CATALOG_MODELS.map((model) => [model.id, model.estimatedClipUsd])));
  });

  it("keeps the UI fixture equal to the real catalog", () => {
    const view = catalogView({ acknowledgements: [modalAck, legacyAlibabaAck], slide: potty });
    expect(catalogResponseSchema.parse(catalogFixture)).toEqual(view);
  });
});

describe("GET /api/catalog", () => {
  it("lists three models with costs, LTX marked default", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = catalogResponseSchema.parse(await response.json());
    expect(body.defaultModelId).toBe("ltx-2.5-distilled");
    expect(body.models.map((model) => [model.id, model.isDefault, model.estimatedClipUsd])).toEqual([
      ["ltx-2.5-distilled", true, 0.03],
      ["wan2.7-i2v", false, 0.5],
      ["wan3-i2v", false, 0.5],
    ]);
    expect(body.models.every((model) => model.fit === undefined)).toBe(true);
  });

  it("says how each model fits a slide", async () => {
    const body = catalogResponseSchema.parse(await (await get(`?creationId=${creation.id}&slideId=${potty.id}`)).json());
    expect(body.models[0].fit).toEqual({ ok: true });
    expect(body.models[1].fit).toEqual({ ok: true, reason: expect.stringContaining("walk into your text") });
  });

  it("needs both ids and an existing slide", async () => {
    expect((await get(`?slideId=${potty.id}`)).status).toBe(400);
    const missing = await get(`?creationId=${creation.id}&slideId=${crypto.randomUUID()}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("slide_not_found");
  });

  it("keeps old per-model Alibaba acknowledgements valid and asks separately for Modal", async () => {
    repo.listModelAcknowledgements.mockResolvedValue([legacyAlibabaAck]);
    const body = catalogResponseSchema.parse(await (await get()).json());
    expect(body.models.map((model) => model.billingAcknowledged)).toEqual([false, true, true]);
    repo.listModelAcknowledgements.mockResolvedValue([modalAck]);
    const modal = catalogResponseSchema.parse(await (await get()).json());
    expect(modal.models.map((model) => model.billingAcknowledged)).toEqual([true, false, false]);
  });
});

describe("POST /api/catalog/acknowledgements", () => {
  it("records one acknowledgement per provider and price version", async () => {
    repo.acknowledgeModel.mockResolvedValue({ billing_acknowledged_at: "2026-09-30T23:00:00.000Z" });
    const response = await acknowledge(new Request("https://studio.test/api/catalog/acknowledgements", {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: JSON.stringify({ provider: "modal-ltx" }),
    }));
    expect(response.status).toBe(201);
    expect(billingAcknowledgementResponseSchema.parse(await response.json())).toEqual({
      provider: "modal-ltx", version: "modal-billing-v1", acknowledgedAt: "2026-09-30T23:00:00.000Z",
    });
    expect(repo.acknowledgeModel).toHaveBeenCalledWith({
      modelId: "provider:modal-ltx", contractVersion: "modal-billing-v1", textVersion: "modal-billing-v1",
    });
  });

  it("rejects an unknown provider", async () => {
    const response = await acknowledge(new Request("https://studio.test/api/catalog/acknowledgements", {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: JSON.stringify({ provider: "runpod" }),
    }));
    expect(response.status).toBe(400);
  });
});

describe("fit for a slide", () => {
  const slide = (overrides: Partial<SlideV2>): SlideV2 => ({ ...potty, ...overrides });
  const ltx = getCatalogModel("ltx-2.5-distilled")!;
  const wan = getCatalogModel("wan2.7-i2v")!;

  it("greys every model out until the background is uploaded and passes its checks", () => {
    const empty = slide({ width: null, height: null, layers: { backgroundAssetId: null, textAssetId: null }, checks: undefined });
    expect(fitForSlide(ltx, empty).ok).toBe(false);
    const broken = slide({ checks: { ok: false, items: [{ code: "size_mismatch", severity: "error", message: "Sizes differ." }] } });
    expect(fitForSlide(wan, broken)).toEqual({ ok: false, reason: expect.stringContaining("upload problems") });
  });

  it("warns, without blocking, when a model cannot pin the end frame over text", () => {
    expect(fitForSlide(wan, slide({}))).toEqual({ ok: true, reason: expect.stringContaining("walk into your text") });
    expect(fitForSlide(wan, slide({ layers: { ...potty.layers, textAssetId: null } }))).toEqual({
      ok: true, reason: expect.stringContaining("Not yet tested"),
    });
  });
});
