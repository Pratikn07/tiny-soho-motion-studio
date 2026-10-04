import { createHash } from "node:crypto";

import {
  creationDocumentV2Schema,
  directionResultSchema,
  type CreationDocumentV2,
  type DirectionResult,
  type DirectionRunView,
  type DirectionStartRequest,
} from "@/lib/contract";
import { findSlide, slideFolder, withSlideLayers } from "@/lib/creations";
import { StudioError } from "@/lib/errors";
import type { CreationsRepository } from "@/lib/repo/creations";
import type { DirectionRepository, DirectionRunRow } from "@/lib/repo/direction";
import { validateSourceImage } from "@/lib/storage";
import { runUploadChecks } from "@/lib/upload-checks";

export const BUCKET = "creative-studio";
/** What the routine uploads for each slide (see tiny-soho-motion-runtime/tools/jobio.py). */
export const OUTPUT_FILES = ["plate.png", "text-layer.png", "plan.json", "preview.mp4", "frames.jpg"] as const;
/** Slides stay downloadable for the routine this long. Supabase signed upload URLs last two hours. */
const DOWNLOAD_SECONDS = 3 * 60 * 60;
/** A run with no result after this long is marked failed. */
export const DIRECTION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const extension: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const mimeFor: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export const finishedFileStem = (assetId: string) => `finished-${assetId}`;

export function finishedObjectPath(owner: string, projectId: string, slideId: string, assetId: string, mime: string) {
  const ext = extension[mime];
  if (!ext) throw new StudioError(400, "finished_invalid", "Upload the finished slide as PNG, JPEG or WebP.");
  return `${slideFolder(owner, projectId, slideId)}/${finishedFileStem(assetId)}.${ext}`;
}

export const mimeForFinishedPath = (path: string) => mimeFor[path.split(".").pop() ?? ""] ?? null;

export const runFolder = (owner: string, projectId: string, runId: string) => (
  `owners/${owner}/projects/${projectId}/direction/${runId}`
);
export const outputPath = (owner: string, projectId: string, runId: string, slideId: string, file: string) => (
  `${runFolder(owner, projectId, runId)}/${slideId}/${file}`
);
export const resultPath = (owner: string, projectId: string, runId: string) => (
  `${runFolder(owner, projectId, runId)}/result.json`
);

/** A stable UUID for an asset a run creates, so finalising twice never makes duplicates. */
export function stableAssetId(runId: string, slideId: string, file: string) {
  const hex = createHash("sha256").update(`${runId}:${slideId}:${file}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The routine payload: plain text, one download and five uploads per slide, then the result upload. */
export function buildPayload(
  runId: string,
  slides: Array<{ slideId: string; getUrl: string; puts: Record<string, string> }>,
  resultUrl: string,
) {
  const lines = ["tiny-soho-job v1", `job: ${runId}`];
  slides.forEach((slide, index) => {
    lines.push(`slide ${index + 1} ${slide.slideId}`, `  get ${slide.getUrl}`);
    for (const file of OUTPUT_FILES) lines.push(`  put ${file} ${slide.puts[file]}`);
  });
  lines.push(`result ${resultUrl}`);
  return lines.join("\n");
}

export type RoutineConfig = { url: string; token: string };
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export function readRoutineConfig(env: Record<string, string | undefined> = process.env): RoutineConfig | null {
  const url = env.TINY_SOHO_ROUTINE_FIRE_URL?.trim();
  const token = env.TINY_SOHO_ROUTINE_FIRE_TOKEN?.trim();
  if (!url || !token) return null;
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(url)) return null;
  return { url, token };
}

/** Starts one routine session. Error bodies are never forwarded; callers get a stable code. */
export async function fireRoutine(config: RoutineConfig, text: string, fetcher: Fetcher = fetch) {
  if (text.length > 65_536) throw new StudioError(400, "direction_too_large", "Too many slides for one run.");
  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new StudioError(502, "routine_unavailable", "The motion director could not be started.");
  }
  if (response.status === 429) throw new StudioError(429, "routine_busy", "The motion director is busy. Try again later.");
  if (!response.ok) throw new StudioError(502, "routine_unavailable", "The motion director could not be started.");
  const body = await response.json().catch(() => null) as { claude_code_session_id?: unknown; claude_code_session_url?: unknown } | null;
  const sessionId = typeof body?.claude_code_session_id === "string" ? body.claude_code_session_id : null;
  const sessionUrl = typeof body?.claude_code_session_url === "string" ? body.claude_code_session_url : null;
  if (!sessionId) throw new StudioError(502, "routine_unavailable", "The motion director could not be started.");
  return { sessionId, sessionUrl };
}

type Storage = {
  from: (bucket: string) => {
    createSignedUrl: (path: string, seconds: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    createSignedUploadUrl: (path: string, options?: { upsert?: boolean }) => Promise<{
      data: { signedUrl: string } | null; error: unknown;
    }>;
    download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
  };
};
type Scope = {
  owner: { userId: string };
  client: { storage: Storage };
  repo: CreationsRepository;
  direction: DirectionRepository;
};

async function signDownload(scope: Scope, path: string, seconds: number) {
  const { data, error } = await scope.client.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new StudioError(502, "studio_storage_sign_failed", "Storage is unavailable.");
  return data.signedUrl;
}

async function signUpload(scope: Scope, path: string) {
  const { data, error } = await scope.client.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.signedUrl) throw new StudioError(502, "upload_unavailable", "Storage is unavailable.");
  return data.signedUrl;
}

async function download(scope: Scope, path: string) {
  const { data, error } = await scope.client.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Creates the run (idempotent on the key), signs every link, and fires the routine once. */
export async function startDirection(
  scope: Scope,
  projectId: string,
  input: DirectionStartRequest,
  config: RoutineConfig,
  fetcher?: Fetcher,
): Promise<DirectionRunRow> {
  const creation = await scope.repo.requireCreation(projectId);
  const finished = [];
  for (const slide of input.slides) {
    findSlide(creation.document, slide.slideId);
    const asset = await scope.direction.getAsset(slide.finishedAssetId);
    if (!asset || asset.project_id !== projectId || asset.kind !== "source-image"
      || !asset.object_path.startsWith(`${slideFolder(scope.owner.userId, projectId, slide.slideId)}/finished-`)) {
      throw new StudioError(400, "finished_missing", "Upload each finished slide before directing it.");
    }
    finished.push({ ...slide, objectPath: asset.object_path });
  }

  const runId = crypto.randomUUID();
  const { run, created } = await scope.direction.createRun({
    id: runId,
    projectId,
    idempotencyKey: input.idempotencyKey,
    slides: input.slides,
  });
  if (!created || run.status !== "queued") return run;

  try {
    const slides = [];
    for (const slide of finished) {
      const puts: Record<string, string> = {};
      for (const file of OUTPUT_FILES) {
        puts[file] = await signUpload(scope, outputPath(scope.owner.userId, projectId, run.id, slide.slideId, file));
      }
      slides.push({ slideId: slide.slideId, getUrl: await signDownload(scope, slide.objectPath, DOWNLOAD_SECONDS), puts });
    }
    const resultUrl = await signUpload(scope, resultPath(scope.owner.userId, projectId, run.id));
    const session = await fireRoutine(config, buildPayload(run.id, slides, resultUrl), fetcher);
    return await scope.direction.updateRun(run.id, {
      status: "running",
      routine_session_id: session.sessionId,
      routine_session_url: session.sessionUrl,
      fired_at: new Date().toISOString(),
    });
  } catch (error) {
    const code = error instanceof StudioError ? error.code : "routine_unavailable";
    await scope.direction.updateRun(run.id, { status: "failed", error_code: code, completed_at: new Date().toISOString() });
    throw error;
  }
}

function motionFromResult(slide: DirectionResult["slides"][number]) {
  const scene = slide.scene_prompt?.trim();
  if (!scene) return undefined;
  const avoid = slide.scene_avoid?.trim();
  return {
    source: "creator" as const,
    story: scene.slice(0, 1000),
    prompt: (avoid ? `${scene}\nAvoid: ${avoid}` : scene).slice(0, 5000),
  };
}

/** Turns one directed slide's uploads into assets and points the slide at them. Safe to repeat. */
async function finaliseSlide(
  scope: Scope,
  run: DirectionRunRow,
  slide: DirectionResult["slides"][number],
): Promise<{ ok: true; ids: Record<string, string>; preview: boolean } | { ok: false; error: string }> {
  const owner = scope.owner.userId;
  const path = (file: string) => outputPath(owner, run.project_id, run.id, slide.slide_id, file);
  const [plate, text, preview] = await Promise.all([
    download(scope, path("plate.png")),
    download(scope, path("text-layer.png")),
    download(scope, path("preview.mp4")),
  ]);
  if (!plate || !text) return { ok: false, error: "outputs_missing" };
  let plateImage;
  let textImage;
  try {
    plateImage = await validateSourceImage(new File([plate], "plate.png", { type: "image/png" }));
    textImage = await validateSourceImage(new File([text], "text-layer.png", { type: "image/png" }));
  } catch {
    return { ok: false, error: "outputs_invalid" };
  }
  if (plateImage.width !== textImage.width || plateImage.height !== textImage.height) {
    return { ok: false, error: "outputs_size_mismatch" };
  }
  const ids = {
    background: stableAssetId(run.id, slide.slide_id, "plate.png"),
    text: stableAssetId(run.id, slide.slide_id, "text-layer.png"),
    preview: stableAssetId(run.id, slide.slide_id, "preview.mp4"),
  };
  const provenance = { source: "direction-run", runId: run.id, slideId: slide.slide_id };
  await scope.direction.insertAsset({
    id: ids.background, projectId: run.project_id, kind: "background-image", name: "plate.png",
    mimeType: plateImage.mimeType, objectPath: path("plate.png"), byteSize: plateImage.bytes.length,
    width: plateImage.width, height: plateImage.height, sha256: plateImage.sha256, provenance,
  });
  await scope.direction.insertAsset({
    id: ids.text, projectId: run.project_id, kind: "text-layer", name: "text-layer.png",
    mimeType: "image/png", objectPath: path("text-layer.png"), byteSize: textImage.bytes.length,
    width: textImage.width, height: textImage.height, sha256: textImage.sha256, provenance,
  });
  if (preview) {
    await scope.direction.insertAsset({
      id: ids.preview, projectId: run.project_id, kind: "derived-video", name: "preview.mp4",
      mimeType: "video/mp4", objectPath: path("preview.mp4"), byteSize: preview.length,
      width: plateImage.width, height: plateImage.height,
      sha256: createHash("sha256").update(preview).digest("hex"), provenance,
    });
  }

  const checks = await runUploadChecks(plateImage.bytes, textImage.bytes);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const creation = await scope.repo.requireCreation(run.project_id);
    let document: CreationDocumentV2 = withSlideLayers(creation.document, slide.slide_id, {
      background: { assetId: ids.background, width: plateImage.width, height: plateImage.height },
      textAssetId: ids.text,
      checks,
    });
    const motion = motionFromResult(slide);
    if (motion) {
      document = creationDocumentV2Schema.parse({
        ...document,
        slides: document.slides.map((s) => (s.id === slide.slide_id && !s.motion ? { ...s, motion } : s)),
      });
    }
    try {
      await scope.repo.saveCreation(run.project_id, creation.revision, document);
      return { ok: true, ids, preview: Boolean(preview) };
    } catch (error) {
      if (!(error instanceof StudioError) || error.status !== 409 || attempt === 2) throw error;
    }
  }
  return { ok: false, error: "creation_conflict" };
}

/** Checks a running run for its result and finalises it; marks it failed after the timeout. */
export async function refreshDirection(scope: Scope, run: DirectionRunRow, now = Date.now()): Promise<DirectionRunRow> {
  if (run.status !== "running") return run;
  const bytes = await download(scope, resultPath(scope.owner.userId, run.project_id, run.id));
  if (!bytes) {
    if (run.fired_at && now - Date.parse(run.fired_at) > DIRECTION_TIMEOUT_MS) {
      return scope.direction.updateRun(run.id, {
        status: "failed", error_code: "direction_timeout", completed_at: new Date(now).toISOString(),
      });
    }
    return run;
  }
  const parsed = directionResultSchema.safeParse(JSON.parse(bytes.toString("utf8") || "null"));
  if (!parsed.success || parsed.data.job !== run.id) {
    return scope.direction.updateRun(run.id, {
      status: "failed", error_code: "result_invalid", completed_at: new Date(now).toISOString(),
    });
  }
  const expected = new Set(run.slides.map((s) => s.slideId));
  const finalised: Record<string, unknown> = {};
  const slides = parsed.data.slides.filter((s) => expected.has(s.slide_id));
  for (const slide of slides) {
    if (slide.status !== "completed") {
      finalised[slide.slide_id] = { ok: false, error: slide.error ?? "not_directed" };
      continue;
    }
    finalised[slide.slide_id] = await finaliseSlide(scope, run, slide);
  }
  const done = Object.values(finalised).filter((f) => (f as { ok: boolean }).ok).length;
  const status = done === run.slides.length ? "completed" : done > 0 ? "partial" : "failed";
  return scope.direction.updateRun(run.id, {
    status,
    result: { ...parsed.data, finalised },
    error_code: status === "failed" ? "direction_failed" : null,
    completed_at: new Date(now).toISOString(),
  });
}

/** The run as the creation UI sees it, with short-lived preview links for directed slides. */
export async function directionView(scope: Scope, run: DirectionRunRow): Promise<DirectionRunView> {
  const results = new Map((run.result?.slides ?? []).map((s) => [s.slide_id, s]));
  const finalised = (run.result?.finalised ?? {}) as Record<string, { ok: boolean; error?: string; preview?: boolean }>;
  const slides = [];
  for (const { slideId } of run.slides) {
    const outcome = finalised[slideId];
    const result = results.get(slideId);
    if (!outcome) {
      slides.push({ slideId, status: run.status === "failed" ? "failed" as const : "pending" as const });
      continue;
    }
    if (!outcome.ok) {
      slides.push({ slideId, status: "failed" as const, error: outcome.error ?? result?.error ?? "not_directed" });
      continue;
    }
    slides.push({
      slideId,
      status: "completed" as const,
      ...(result?.concept ? { concept: result.concept } : {}),
      ...(result?.scene_prompt ? { scenePrompt: result.scene_prompt } : {}),
      ...(outcome.preview
        ? { previewUrl: await signDownload(scope, outputPath(scope.owner.userId, run.project_id, run.id, slideId, "preview.mp4"), 600) }
        : {}),
    });
  }
  return {
    id: run.id,
    status: run.status,
    sessionUrl: run.routine_session_url,
    errorCode: run.error_code,
    slides,
    createdAt: run.created_at,
    completedAt: run.completed_at,
  };
}
