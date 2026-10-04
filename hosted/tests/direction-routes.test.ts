import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUT as saveCreation } from "@/app/api/creations/[id]/route";
import { GET as getRun } from "@/app/api/creations/[id]/direction/[runId]/route";
import { POST as startRun } from "@/app/api/creations/[id]/direction/route";
import { POST as signFinished, PUT as finaliseFinished } from "@/app/api/creations/[id]/slides/[slideId]/finished/route";
import { POST as createCreation } from "@/app/api/creations/route";
import { requireOwner } from "@/lib/auth";
import {
  creationViewSchema,
  directionRunViewSchema,
  finishedFinaliseResponseSchema,
  finishedUploadResponseSchema,
  type CreationView,
} from "@/lib/contract";
import { DIRECTION_TIMEOUT_MS, OUTPUT_FILES, stableAssetId } from "@/lib/direction";
import { StudioError } from "@/lib/errors";
import { creationsFakeSupabase } from "./creations-fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./creations-fake-supabase").creationsFakeSupabase> | null }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: () => fake.current!.client }));

const owner = { userId: "00000000-0000-4000-8000-00000000000a", email: "owner@test" };
const call = (method: string, body?: unknown) => new Request("https://studio.test/api/creations", {
  method,
  headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;

const slideId = "0b9e7c52-1d3a-4f6b-8a2c-7e5d4c3b2a10";
const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01TESTROUTINE/fire";

const rgb = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 230, g: 220, b: 210 } } })
  .png().toBuffer();
/** A transparent layer with one opaque cocoa block where text would be. */
async function textLayer(w: number, h: number) {
  const block = await sharp({ create: { width: Math.floor(w / 2), height: 20, channels: 4, background: { r: 50, g: 23, b: 8, alpha: 1 } } })
    .png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: block, left: 10, top: 20 }]).png().toBuffer();
}

async function creationWithSlide(): Promise<CreationView> {
  const created = creationViewSchema.parse(await (await createCreation(call("POST", { name: "Toddler morning" }))).json());
  const document = {
    ...created.document,
    slides: [{ id: slideId, name: "slide 1", order: 0, width: null, height: null, layers: { backgroundAssetId: null, textAssetId: null } }],
  };
  return creationViewSchema.parse(await (await saveCreation(call("PUT", { revision: created.revision, document }), params({ id: created.id }))).json());
}

async function uploadFinished(creation: CreationView) {
  const assetId = crypto.randomUUID();
  const bytes = await rgb(200, 250);
  const signed = finishedUploadResponseSchema.parse(await (await signFinished(
    call("POST", { assetId, fileName: "slide-1.png", mime: "image/png", size: bytes.length }),
    params({ id: creation.id, slideId }),
  )).json());
  fake.current!.uploadTo(signed.signedUrl, bytes, "image/png");
  const finalised = await finaliseFinished(call("PUT", { assetId }), params({ id: creation.id, slideId }));
  expect(finalised.status).toBe(200);
  return finishedFinaliseResponseSchema.parse(await finalised.json());
}

/** Parses the routine payload the app sent: per slide, the upload URL for each output file, plus the result URL. */
function parsePayload(text: string) {
  const lines = text.split("\n");
  const puts: Record<string, string> = {};
  let result = "";
  for (const line of lines) {
    const put = line.trim().match(/^put (\S+) (\S+)$/);
    if (put) puts[put[1]] = put[2];
    const res = line.match(/^result (\S+)$/);
    if (res) result = res[1];
  }
  return { lines, puts, result };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fake.current = creationsFakeSupabase();
  vi.mocked(requireOwner).mockImplementation(async (request: Request) => {
    if (request.headers.get("authorization") !== "Bearer owner") throw new StudioError(401, "invalid_token", "Authentication is required.");
    return owner;
  });
  process.env.TINY_SOHO_ROUTINE_FIRE_URL = FIRE_URL;
  process.env.TINY_SOHO_ROUTINE_FIRE_TOKEN = "sk-ant-oat01-test";
  fetchMock = vi.fn(async () => Response.json({
    type: "routine_fire",
    claude_code_session_id: "cse_test",
    claude_code_session_url: "https://claude.ai/code/cse_test",
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TINY_SOHO_ROUTINE_FIRE_URL;
  delete process.env.TINY_SOHO_ROUTINE_FIRE_TOKEN;
});

describe("finished slide upload", () => {
  it("records a finished slide once and replays the same answer", async () => {
    const creation = await creationWithSlide();
    const first = await uploadFinished(creation);
    expect(first).toMatchObject({ width: 200, height: 250 });
    const again = await finaliseFinished(call("PUT", { assetId: first.assetId }), params({ id: creation.id, slideId }));
    expect(await again.json()).toEqual(first);
    const assets = fake.current!.tables.creative_studio_assets.filter((a) => a.id === first.assetId);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ kind: "source-image", provenance: { source: "creation-finished-upload" } });
  });
});

describe("direction run", () => {
  it("refuses to start when the routine is not configured", async () => {
    delete process.env.TINY_SOHO_ROUTINE_FIRE_TOKEN;
    const creation = await creationWithSlide();
    const finished = await uploadFinished(creation);
    const response = await startRun(call("POST", {
      idempotencyKey: crypto.randomUUID(), slides: [{ slideId, finishedAssetId: finished.assetId }],
    }), params({ id: creation.id }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a slide whose finished image was never uploaded", async () => {
    const creation = await creationWithSlide();
    const response = await startRun(call("POST", {
      idempotencyKey: crypto.randomUUID(), slides: [{ slideId, finishedAssetId: crypto.randomUUID() }],
    }), params({ id: creation.id }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("finished_missing");
  });

  it("fires the routine once with signed links, then finalises the routine's uploads into slide layers", async () => {
    const creation = await creationWithSlide();
    const finished = await uploadFinished(creation);
    const idempotencyKey = crypto.randomUUID();
    const start = () => startRun(call("POST", { idempotencyKey, slides: [{ slideId, finishedAssetId: finished.assetId }] }), params({ id: creation.id }));

    const started = await start();
    expect(started.status).toBe(202);
    const run = directionRunViewSchema.parse(await started.json());
    expect(run).toMatchObject({ status: "running", sessionUrl: "https://claude.ai/code/cse_test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FIRE_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-ant-oat01-test");
    const { lines, puts, result } = parsePayload(JSON.parse(init.body as string).text);
    expect(lines.slice(0, 3)).toEqual(["tiny-soho-job v1", `job: ${run.id}`, `slide 1 ${slideId}`]);
    expect(lines[3]).toMatch(/^ {2}get https:\/\/storage\.test\/sign\/.*finished-/);
    expect(Object.keys(puts).sort()).toEqual([...OUTPUT_FILES].sort());
    expect(result).toContain(`/direction/${run.id}/result.json`);

    // A retried start with the same key returns the same run and does not fire again.
    const retried = directionRunViewSchema.parse(await (await start()).json());
    expect(retried.id).toBe(run.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Before the routine finishes, the run is still running.
    const pending = directionRunViewSchema.parse(await (await getRun(call("GET"), params({ id: creation.id, runId: run.id }))).json());
    expect(pending.status).toBe("running");

    // The routine uploads its outputs, then result.json.
    fake.current!.uploadTo(puts["plate.png"], await rgb(200, 250), "image/png");
    fake.current!.uploadTo(puts["text-layer.png"], await textLayer(200, 250), "image/png");
    fake.current!.uploadTo(puts["plan.json"], Buffer.from("{}"), "application/json");
    fake.current!.uploadTo(puts["preview.mp4"], Buffer.from("fake mp4"), "video/mp4");
    fake.current!.uploadTo(puts["frames.jpg"], await sharp(await rgb(50, 60)).jpeg().toBuffer(), "image/jpeg");
    fake.current!.uploadTo(result, Buffer.from(JSON.stringify({
      version: 1,
      job: run.id,
      slides: [{ n: 1, slide_id: slideId, status: "completed", concept: "story",
        scene_prompt: "She lifts the dinosaur shirt out of the basket.", scene_avoid: "No camera moves." }],
    })), "application/json");

    const done = directionRunViewSchema.parse(await (await getRun(call("GET"), params({ id: creation.id, runId: run.id }))).json());
    expect(done.status).toBe("completed");
    expect(done.slides[0]).toMatchObject({ status: "completed", concept: "story" });
    expect(done.slides[0].previewUrl).toContain("preview.mp4");

    const backgroundId = stableAssetId(run.id, slideId, "plate.png");
    const textId = stableAssetId(run.id, slideId, "text-layer.png");
    const project = fake.current!.tables.creative_studio_projects.find((p) => p.id === creation.id)!;
    const slide = project.carousel_document.slides[0];
    expect(slide).toMatchObject({ width: 200, height: 250, layers: { backgroundAssetId: backgroundId, textAssetId: textId } });
    expect(slide.motion).toMatchObject({ source: "creator", prompt: "She lifts the dinosaur shirt out of the basket.\nAvoid: No camera moves." });
    expect(slide.checks).toBeDefined();
    const kinds = fake.current!.tables.creative_studio_assets
      .filter((a) => a.provenance?.source === "direction-run").map((a) => a.kind).sort();
    expect(kinds).toEqual(["background-image", "derived-video", "text-layer"]);

    // Polling again changes nothing and creates no duplicates.
    const again = directionRunViewSchema.parse(await (await getRun(call("GET"), params({ id: creation.id, runId: run.id }))).json());
    expect(again.status).toBe("completed");
    expect(fake.current!.tables.creative_studio_assets.filter((a) => a.provenance?.source === "direction-run")).toHaveLength(3);
  });

  it("records a failed fire without leaving the run running", async () => {
    fetchMock.mockImplementation(async () => new Response("nope", { status: 500 }));
    const creation = await creationWithSlide();
    const finished = await uploadFinished(creation);
    const response = await startRun(call("POST", {
      idempotencyKey: crypto.randomUUID(), slides: [{ slideId, finishedAssetId: finished.assetId }],
    }), params({ id: creation.id }));
    expect(response.status).toBe(502);
    const rows = fake.current!.tables.creative_studio_direction_runs;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", error_code: "routine_unavailable" });
  });

  it("fails a run that never reports back, and rejects a result for another job", async () => {
    const creation = await creationWithSlide();
    const finished = await uploadFinished(creation);
    const run = directionRunViewSchema.parse(await (await startRun(call("POST", {
      idempotencyKey: crypto.randomUUID(), slides: [{ slideId, finishedAssetId: finished.assetId }],
    }), params({ id: creation.id }))).json());

    const row = fake.current!.tables.creative_studio_direction_runs.find((r) => r.id === run.id)!;
    row.fired_at = new Date(Date.now() - DIRECTION_TIMEOUT_MS - 60_000).toISOString();
    const timedOut = directionRunViewSchema.parse(await (await getRun(call("GET"), params({ id: creation.id, runId: run.id }))).json());
    expect(timedOut).toMatchObject({ status: "failed", errorCode: "direction_timeout" });

    const second = directionRunViewSchema.parse(await (await startRun(call("POST", {
      idempotencyKey: crypto.randomUUID(), slides: [{ slideId, finishedAssetId: finished.assetId }],
    }), params({ id: creation.id }))).json());
    const { result } = parsePayload(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string).text);
    fake.current!.uploadTo(result, Buffer.from(JSON.stringify({ version: 1, job: crypto.randomUUID(), slides: [] })), "application/json");
    const invalid = directionRunViewSchema.parse(await (await getRun(call("GET"), params({ id: creation.id, runId: second.id }))).json());
    expect(invalid).toMatchObject({ status: "failed", errorCode: "result_invalid" });
  });
});
