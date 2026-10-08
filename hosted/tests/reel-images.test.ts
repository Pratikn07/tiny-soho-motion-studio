import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as removeImage, POST as startUpload, PUT as finishUpload } from "@/app/api/reels/[id]/images/route";
import { GET as getReel } from "@/app/api/reels/[id]/route";
import { requireOwner } from "@/lib/auth";
import { evaluateReelImage, inspectReelImage } from "@/lib/reel-images";
import { imagesReused, imagesToMake, type ReelScene } from "@/lib/reels";
import { creationsFakeSupabase } from "./creations-fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./creations-fake-supabase").creationsFakeSupabase> | null }));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: () => fake.current!.client }));

const OWNER = "33333333-3333-4333-8333-333333333333";
const REEL = "55555555-5555-4555-8555-555555555555";
const LOOK = { name: "Evidence board", treatment: "Corkboard", emotion: "Calm", accent: "Sage", signatureMoment: "Stamp", music: "Pizzicato", why: "Fits" };
const image = (file: string, extra: Record<string, unknown> = {}) => ({
  file, purpose: "Purpose", prompt: "Prompt", aspect: "4:5", background: "transparent" as const, reference: "none" as const, reuse: "", ...extra,
});
const scene = (n: number, images: ReturnType<typeof image>[]): ReelScene => ({ n, line: `Line ${n}`, paper: "Cream", codeDraws: "Card", move: "Rise", transition: "Push", images });
// Like the 4-Bite Dinner storyboard: props made in scene 1 and reused by name later; a reel 01 asset reused.
const SCENES = [
  scene(1, [image("r01_anaika_four_bites.png", { background: "opaque" }), image("r01_evidence_props.png", { aspect: "1:1" })]),
  scene(2, [image("r02_meal_plates.png", { aspect: "1:1" })]),
  scene(3, [image("r02_meal_plates.png", { reuse: "r02_meal_plates", aspect: "1:1" })]),
  scene(4, [image("r01_evidence_props.png", { reuse: "r01_evidence_props", aspect: "1:1" }), image("clock.png", { reuse: "reel01 clock face with no hands" })]),
];
const STORYBOARD = { version: 1, scenes: SCENES, approved: true };

const context = { params: Promise.resolve({ id: REEL }) };
const json = (method: string, body?: unknown, query = "") => new Request(`https://studio.test/api/reels/${REEL}/images${query}`, {
  method, headers: { authorization: "Bearer owner", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
});

async function png(width: number, height: number, clear: boolean) {
  const base = sharp({ create: { width, height, channels: 4, background: { r: 244, g: 234, b: 220, alpha: clear ? 0 : 1 } } });
  return base.composite([{ input: { create: { width: Math.round(width / 2), height: Math.round(height / 2), channels: 4, background: { r: 176, g: 84, b: 76, alpha: 1 } } }, gravity: "center" }]).png().toBuffer();
}

describe("reel image checks", () => {
  it("passes a transparent 4:5 PNG and flags a JPEG where a cut-out was asked", async () => {
    const cutout = await inspectReelImage(await png(1080, 1350, true), "image/png");
    expect(cutout.width).toBe(1080);
    expect(cutout.transparentShare).toBeGreaterThan(0.5);
    expect(evaluateReelImage(cutout, { aspect: "4:5", background: "transparent" }).map((check) => check.level)).toEqual(["ok", "ok", "ok"]);

    const photo = await inspectReelImage(await sharp(await png(1080, 1080, false)).jpeg().toBuffer(), "image/jpeg");
    const checks = evaluateReelImage(photo, { aspect: "4:5", background: "transparent" });
    expect(checks.find((check) => check.code === "aspect")).toMatchObject({ level: "warn", message: expect.stringContaining("1:1") });
    expect(checks.find((check) => check.code === "transparent")).toMatchObject({ level: "fail" });
  });

  it("warns about small images and refuses a file that isn't what it claims", async () => {
    const small = await inspectReelImage(await png(400, 500, true), "image/png");
    expect(evaluateReelImage(small, { aspect: "4:5", background: "transparent" }).find((check) => check.code === "size")).toMatchObject({ level: "warn" });
    await expect(inspectReelImage(await png(100, 100, true), "image/jpeg")).rejects.toMatchObject({ code: "unreadable_image" });
    await expect(inspectReelImage(Buffer.from("not an image"), "image/png")).rejects.toMatchObject({ code: "unreadable_image" });
  });
});

describe("images to make", () => {
  it("lists each image once with every scene that uses it, and reel 01 reuses separately", () => {
    expect(imagesToMake(STORYBOARD).map((item) => [item.file, item.scenes])).toEqual([
      ["r01_anaika_four_bites.png", [1]], ["r01_evidence_props.png", [1, 4]], ["r02_meal_plates.png", [2, 3]],
    ]);
    expect(imagesReused(STORYBOARD)).toEqual([{ reuse: "reel01 clock face with no hands", scenes: [4] }]);
  });
});

describe("reel image upload routes", () => {
  beforeEach(() => {
    fake.current = creationsFakeSupabase();
    vi.mocked(requireOwner).mockResolvedValue({ userId: OWNER } as never);
    fake.current.tables.creative_studio_reels = [{
      id: REEL, owner_user_id: OWNER, title: "The 4-Bite Dinner", status: "in_progress", current_step: "images", revision: 1,
      updated_at: "2026-10-08T00:00:00.000Z", document: { look: { options: [LOOK], rejected: [], chosen: LOOK }, storyboard: STORYBOARD },
    }];
  });

  async function upload(file: string, bytes: Buffer, mime = "image/png") {
    const started = await (await startUpload(json("POST", { file, mime, size: bytes.length }), context)).json();
    fake.current!.uploadTo(started.uploadUrl, bytes, mime);
    return finishUpload(json("PUT", { file, uploadId: started.uploadId }), context);
  }

  it("uploads, checks, records and queues the Studio Mac's look, then replaces and removes", async () => {
    const first = await upload("r01_evidence_props.png", await png(1200, 1200, true));
    expect(first.status).toBe(200);
    const view = await first.json();
    const record = view.document.images["r01_evidence_props.png"];
    expect(record).toMatchObject({ mime: "image/png", width: 1200, height: 1200, review: { status: "pending" } });
    expect(record.objectPath).toMatch(new RegExp(`^owners/${OWNER}/reels/${REEL}/images/r01_evidence_props-`));
    expect(record.checks.every((check: { level: string }) => check.level === "ok")).toBe(true);
    expect(view.imageUrls["r01_evidence_props.png"]).toContain("https://storage.test/sign/");
    const jobs = fake.current!.tables.creative_studio_reel_jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ step: "images", kind: "draft", input: { phase: "review", file: "r01_evidence_props.png", uploadId: record.uploadId } });

    const second = await (await upload("r01_evidence_props.png", await png(1200, 1200, true))).json();
    const replaced = second.document.images["r01_evidence_props.png"];
    expect(replaced.uploadId).not.toBe(record.uploadId);
    expect(fake.current!.objects.has(record.objectPath)).toBe(false);
    expect(fake.current!.objects.has(replaced.objectPath)).toBe(true);

    const removed = await (await removeImage(json("DELETE", undefined, "?file=r01_evidence_props.png"), context)).json();
    expect(removed.document.images["r01_evidence_props.png"]).toBeUndefined();
    expect(fake.current!.objects.has(replaced.objectPath)).toBe(false);
  });

  it("refuses files the storyboard doesn't ask for, and files that aren't images", async () => {
    const unknown = await startUpload(json("POST", { file: "clock.png", mime: "image/png", size: 100 }), context);
    expect(unknown.status).toBe(409);
    const fakeImage = await upload("r02_meal_plates.png", Buffer.from("not really a png"));
    expect(fakeImage.status).toBe(400);
    expect(fake.current!.objects.size).toBe(0);
  });

  it("folds the Studio Mac's verdict into the upload it was made for", async () => {
    const view = await (await upload("r02_meal_plates.png", await png(1080, 1080, true))).json();
    const job = fake.current!.tables.creative_studio_reel_jobs[0];
    Object.assign(job, { status: "needs_review", result: { phase: "review", file: "r02_meal_plates.png", uploadId: view.document.images["r02_meal_plates.png"].uploadId, verdict: "redo", notes: "Plates need a white edge." } });
    const read = await (await getReel(new Request(`https://studio.test/api/reels/${REEL}`, { headers: { authorization: "Bearer owner" } }), context)).json();
    expect(read.document.images["r02_meal_plates.png"].review).toMatchObject({ status: "redo", notes: "Plates need a white edge.", jobId: job.id });
  });
});
