import { z } from "zod";

import { StudioError } from "@/lib/errors";
import { briefIsUsable, parseBrief, type ReelBrief } from "@/lib/reel-brief";

type DataClient = { from: (table: string) => any };

/** The steps in the order the creator works through them. Images come before Voice: they follow the storyboard. */
export const REEL_STEPS = ["idea", "script", "storyboard", "images", "voice", "build", "sound", "export"] as const;
export type ReelStep = (typeof REEL_STEPS)[number];

/** Largest sketch kept, in characters. A scene sketch is usually 4–10k. */
export const SKETCH_MAX = 16_000;

/**
 * A sketch is shown as an image (an <img> with an SVG data URL), so scripts in it never run; this also refuses
 * anything that could run or load something if it were ever shown inline.
 */
export function safeSketch(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const svg = value.trim();
  if (svg.length > SKETCH_MAX || !/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) return null;
  if (/<(script|foreignObject|image|iframe|object|embed|use)\b|\bon[a-z]+\s*=|(xlink:)?href\s*=|@import|url\(\s*['"]?(https?:|\/\/|data:)/i.test(svg)) return null;
  return svg;
}

/** A scene without its sketch, for prompts and comparisons. */
export function sceneText({ sketch: _sketch, ...scene }: ReelScene) {
  return scene;
}

export const ideaSchema = z.object({
  title: z.string().min(1).max(120),
  hook: z.string().max(200),
  why: z.string().max(300),
});
export type ReelIdea = z.infer<typeof ideaSchema>;

export const scriptLineSchema = z.object({
  time: z.string().max(12),
  voice: z.string().min(1).max(400),
  onScreen: z.string().max(200),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

/** A reel's look: the treatment for this reel, inside its series theme (docs/reels/claude-project/04). */
export const lookSchema = z.object({
  name: z.string().min(1).max(80),
  // Limits match parseLooks in runner/handlers.mjs; a look over a limit would be dropped when it is read back.
  treatment: z.string().max(800),
  emotion: z.string().max(200),
  accent: z.string().max(120),
  signatureMoment: z.string().max(600),
  music: z.string().max(300),
  why: z.string().max(400),
});
export type ReelLook = z.infer<typeof lookSchema>;

export const imageSchema = z.object({
  file: z.string().min(1).max(80),
  purpose: z.string().max(200),
  prompt: z.string().max(1200),
  aspect: z.string().max(12),
  background: z.enum(["transparent", "opaque"]),
  reference: z.enum(["anaika", "mum", "none"]),
  /** The name of an existing asset to reuse instead of making a new image; empty when it must be made. */
  reuse: z.string().max(120),
});
export type ReelImage = z.infer<typeof imageSchema>;

export const sceneSchema = z.object({
  n: z.number().int().min(1).max(20),
  line: z.string().max(400),
  paper: z.string().max(80),
  codeDraws: z.string().max(400),
  move: z.string().max(300),
  transition: z.string().max(300),
  images: z.array(imageSchema).max(6),
  /** A rough 9:16 sketch of the scene as SVG, drawn by the Studio Mac after the scenes are written. */
  sketch: z.string().max(SKETCH_MAX).optional(),
});
export type ReelScene = z.infer<typeof sceneSchema>;

const timing = z.number().min(0).max(600);
export const voiceTakeSchema = z.object({
  id: z.string().min(1).max(20),
  label: z.string().max(40),
  gap: z.number().min(0).max(2),
  stability: z.number().min(0).max(1),
  objectPath: z.string().max(400),
  seconds: timing,
  lines: z.array(z.object({ n: z.number().int().min(1).max(20), text: z.string().max(400), start: timing, end: timing })).max(20),
  words: z.array(z.object({ n: z.number().int().min(1).max(20), word: z.string().max(60), start: timing, end: timing })).max(400),
  cueCheck: z.object({ ok: z.boolean(), spokenCues: z.array(z.string().max(40)).max(20), heard: z.number().min(0).max(1).nullable(), transcript: z.string().max(2000) }),
});
export type ReelVoiceTake = z.infer<typeof voiceTakeSchema>;
export type ReelVoice = {
  takes: ReelVoiceTake[]; chosen?: string; approved?: boolean; fromJob?: string;
  /** ElevenLabs characters the last job used, and what's left on the plan this month. */
  credits?: { used: number; remaining: number | null; limit: number | null };
};

export type ReelStoryboard = {
  version: number; scenes: ReelScene[]; notes?: string; approved?: boolean; fromJob?: string;
  /** Which job's sketches were last folded in, and which version a sketch job was queued for, so each happens once. */
  sketchesFrom?: string; sketchesQueued?: string;
};

const url = z.string().trim().url().max(500).refine((value) => /^https?:\/\//.test(value), "Use an http(s) link.");

export const createReelSchema = z.object({
  topic: z.string().trim().max(400).default(""),
  title: z.string().trim().max(200).optional(),
  brief: z.string().trim().max(8000).optional(),
  reference: url.optional(),
});

const comments = z.string().trim().min(1).max(1000);
export const reelActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("choose_idea"), idea: ideaSchema }),
  z.object({ action: z.literal("revise_script"), comments }),
  z.object({ action: z.literal("approve_script") }),
  z.object({ action: z.literal("back_to_script") }),
  z.object({ action: z.literal("choose_look"), index: z.number().int().min(0).max(2) }),
  z.object({ action: z.literal("revise_look"), comments, index: z.number().int().min(0).max(2).optional() }),
  z.object({ action: z.literal("more_looks") }),
  z.object({ action: z.literal("own_look"), description: comments }),
  z.object({
    action: z.literal("revise_storyboard"), comments,
    scene: z.number().int().min(1).max(20).optional(), image: z.string().max(80).optional(),
  }),
  z.object({ action: z.literal("edit_image_prompt"), scene: z.number().int().min(1).max(20), file: z.string().min(1).max(80), prompt: z.string().trim().min(1).max(1200) }),
  z.object({ action: z.literal("restore_storyboard"), version: z.number().int().min(1) }),
  z.object({ action: z.literal("approve_storyboard") }),
  z.object({ action: z.literal("redraw_sketches"), scene: z.number().int().min(1).max(20).optional() }),
  z.object({ action: z.literal("recheck_image"), file: z.string().min(1).max(80) }),
  z.object({ action: z.literal("continue_images") }),
  z.object({ action: z.literal("choose_take"), take: z.string().min(1).max(20) }),
  z.object({ action: z.literal("redo_line"), take: z.string().min(1).max(20), n: z.number().int().min(1).max(20), note: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("new_takes") }),
  z.object({ action: z.literal("approve_voice") }),
  z.object({ action: z.literal("add_reference"), url }),
  z.object({ action: z.literal("remove_reference"), url: z.string().max(500) }),
  z.object({ action: z.literal("retry") }),
]);
export type ReelAction = z.infer<typeof reelActionSchema>;

export type ReelJobView = {
  id: string;
  step: ReelStep;
  kind: string;
  status: "queued" | "running" | "needs_review" | "completed" | "failed" | "canceled";
  progress: string | null;
  errorCode: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ReelDocument = {
  topic?: string;
  brief?: ReelBrief;
  /** A reel someone else made that this one learns from; the Studio Mac breaks it down at the Idea step. */
  reference?: { url: string };
  idea?: ReelIdea;
  script?: { lines: ScriptLine[]; notes?: string; approved?: boolean };
  look?: { options: ReelLook[]; chosen?: ReelLook; rejected: string[]; fromJob?: string };
  storyboard?: ReelStoryboard;
  /** Earlier storyboard versions, newest first, so a change can be undone. */
  storyboardHistory?: ReelStoryboard[];
  /** Links the creator added for mood or motion (Savee, prompt-motion, motionin). */
  references?: string[];
  /** Images the creator uploaded at the Images step, by storyboard filename. */
  images?: Record<string, ReelUpload>;
  /** Voice takes from the Studio Mac (ElevenLabs), the chosen one, and whether it is approved. */
  voice?: ReelVoice;
};

/** One instant check on an uploaded image. "fail" means it won't work as it is. */
export type ReelImageCheck = { code: string; level: "ok" | "warn" | "fail"; message: string };

/** An image the creator uploaded for a storyboard file, with the instant checks and the Studio Mac's look at it. */
export type ReelUpload = {
  file: string; uploadId: string; objectPath: string; mime: string; bytes: number; width: number; height: number;
  sha256: string; uploadedAt: string; checks: ReelImageCheck[];
  review: { status: "pending" | "good" | "redo" | "error"; notes: string; jobId?: string };
};

export type ReelView = {
  id: string;
  title: string;
  status: string;
  currentStep: ReelStep;
  document: ReelDocument;
  updatedAt: string;
  /** The newest job for each step that has one. */
  jobs: Partial<Record<ReelStep, ReelJobView>>;
  /** Short-lived links to the uploaded images, by filename (added by the API, not stored). */
  imageUrls?: Record<string, string>;
  /** Short-lived links to the voice takes, by take id (added by the API, not stored). */
  voiceUrls?: Record<string, string>;
  /** The newest image-check job for each uploaded file (several run one after another). */
  imageJobs?: Record<string, ReelJobView & { uploadId?: string }>;
};

export type ReelSummary = { id: string; title: string; status: string; currentStep: ReelStep; updatedAt: string };

const unavailable = () => new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
const notFound = () => new StudioError(404, "reel_not_found", "That reel was not found.");
const conflict = (code: string, message: string) => new StudioError(409, code, message);
const REEL_COLUMNS = "id,title,status,current_step,document,revision,updated_at";
const JOB_COLUMNS = "id,step,kind,status,progress,error_code,result,input,created_at,updated_at";
const HISTORY = 5;

function jobView(row: Record<string, any>): ReelJobView {
  return {
    id: row.id, step: row.step, kind: row.kind, status: row.status, progress: row.progress ?? null,
    errorCode: row.error_code ?? null, result: row.result ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** History keeps the words of earlier versions only; sketches are redrawn if a version is restored. */
function withoutSketches(storyboard: ReelStoryboard): ReelStoryboard {
  return { ...storyboard, scenes: storyboard.scenes.map(sceneText), sketchesFrom: undefined, sketchesQueued: undefined };
}

/** The version to queue sketches for, or null when every scene has one or a job is already queued for this version. */
function sketchesToQueue(doc: ReelDocument) {
  const storyboard = doc.storyboard;
  if (!storyboard || storyboard.approved || !doc.look?.chosen || !storyboard.scenes.some((scene) => !scene.sketch)) return null;
  const key = `${storyboard.fromJob ?? "restored"}-v${storyboard.version}`;
  return storyboard.sketchesQueued === key ? null : key;
}

/** What the Studio Mac needs to draw sketches: the scenes' words, the look and the script timings. */
function sketchInput(doc: ReelDocument, only: number[]) {
  return {
    phase: "sketches", version: doc.storyboard!.version, only, look: doc.look!.chosen,
    scenes: doc.storyboard!.scenes.map(sceneText), script: doc.script?.lines ?? [],
  };
}

/** Every image the storyboard asks for, in scene order. */
export function storyboardImages(storyboard?: ReelStoryboard) {
  return (storyboard?.scenes ?? []).flatMap((scene) => scene.images.map((image) => ({ scene: scene.n, ...image })));
}

/** The name an image is reused by: its filename without the extension. */
const imageName = (file: string) => file.replace(/\.[a-z0-9]+$/i, "");

/**
 * The images to make, once each, with every scene that uses them: scenes that list the file, and later scenes that
 * reuse it by name.
 */
export function imagesToMake(storyboard?: ReelStoryboard) {
  const all = storyboardImages(storyboard);
  const made = new Map<string, ReelImage & { scenes: number[] }>();
  for (const image of all) {
    if (image.reuse) continue;
    const entry = made.get(image.file) ?? { ...image, scenes: [] as number[] };
    if (!entry.scenes.includes(image.scene)) entry.scenes.push(image.scene);
    made.set(image.file, entry);
  }
  for (const image of all) {
    if (!image.reuse) continue;
    const own = made.get(image.file) ?? [...made.values()].find((entry) => imageName(entry.file) === imageName(image.reuse));
    if (own && !own.scenes.includes(image.scene)) own.scenes.push(image.scene);
  }
  return [...made.values()].map((image) => ({ ...image, scenes: image.scenes.sort((a, b) => a - b) }));
}

/** Images reused from earlier reels (nothing to make), once each, with their scenes. */
export function imagesReused(storyboard?: ReelStoryboard) {
  const own = imagesToMake(storyboard);
  const ours = (image: ReelImage) => own.some((entry) => entry.file === image.file || imageName(entry.file) === imageName(image.reuse));
  const byName = new Map<string, { reuse: string; scenes: number[] }>();
  for (const image of storyboardImages(storyboard)) {
    if (!image.reuse || ours(image)) continue;
    const entry = byName.get(image.reuse) ?? { reuse: image.reuse, scenes: [] };
    if (!entry.scenes.includes(image.scene)) entry.scenes.push(image.scene);
    byName.set(image.reuse, entry);
  }
  return [...byName.values()];
}

/** `creative_studio_reels` and their jobs, scoped to one owner. Jobs are picked up by the Studio Mac runner. */
export class ReelsRepository {
  constructor(private client: DataClient, private ownerId: string) {}

  async list(): Promise<ReelSummary[]> {
    const { data, error } = await this.client.from("creative_studio_reels").select(REEL_COLUMNS)
      .eq("owner_user_id", this.ownerId).neq("status", "archived").order("updated_at", { ascending: false }).limit(50);
    if (error) throw unavailable();
    return (data ?? []).map((row: any) => ({ id: row.id, title: row.title, status: row.status, currentStep: row.current_step, updatedAt: row.updated_at }));
  }

  /**
   * Creates a reel. From a brief it skips straight to the script (the brief already is the idea); from a
   * reference reel the Studio Mac breaks the reel down and suggests three angles; from a topic it suggests three ideas.
   */
  async create(input: z.infer<typeof createReelSchema>): Promise<ReelView> {
    const brief = input.brief ? parseBrief(input.brief) : null;
    if (input.brief && (!brief || !briefIsUsable(brief))) {
      throw new StudioError(400, "brief_unreadable", "The brief needs at least a HOOK, an ANGLE or a SCRIPT DRAFT.");
    }
    if (brief) {
      const idea = { title: brief.title || brief.hook?.slice(0, 80) || "New reel", hook: brief.hook ?? "", why: brief.angle?.slice(0, 300) ?? "" };
      const reel = await this.insert(input.title || idea.title, "script", { brief, idea });
      await this.queue(reel.id, "script", "draft", { brief, idea, keepScript: Boolean(brief.scriptDraft?.length) });
      return this.get(reel.id);
    }
    if (input.reference) {
      const reel = await this.insert(input.title || "Reel from a reference", "idea", { reference: { url: input.reference } });
      await this.queue(reel.id, "idea", "draft", { reference: input.reference });
      return this.get(reel.id);
    }
    const title = input.title || (input.topic ? input.topic.slice(0, 80) : "New reel");
    const reel = await this.insert(title, "idea", { topic: input.topic });
    await this.queue(reel.id, "idea", "draft", { topic: input.topic });
    return this.get(reel.id);
  }

  async get(reelId: string): Promise<ReelView> {
    const { data: reel, error } = await this.client.from("creative_studio_reels").select(REEL_COLUMNS)
      .eq("id", reelId).eq("owner_user_id", this.ownerId).maybeSingle();
    if (error) throw unavailable();
    if (!reel) throw notFound();
    const { data: rows, error: jobsError } = await this.client.from("creative_studio_reel_jobs").select(JOB_COLUMNS)
      .eq("reel_id", reelId).eq("owner_user_id", this.ownerId).order("created_at", { ascending: false }).limit(40);
    if (jobsError) throw unavailable();
    const jobs: Partial<Record<ReelStep, ReelJobView>> = {};
    const imageJobs: NonNullable<ReelView["imageJobs"]> = {};
    for (const row of rows ?? []) {
      if (!jobs[row.step as ReelStep]) jobs[row.step as ReelStep] = jobView(row);
      const file = row.step === "images" && typeof row.input?.file === "string" ? row.input.file : null;
      if (file && !imageJobs[file]) imageJobs[file] = { ...jobView(row), uploadId: row.input?.uploadId };
    }
    return {
      id: reel.id, title: reel.title, status: reel.status, currentStep: reel.current_step,
      document: (reel.document ?? {}) as ReelDocument, updatedAt: reel.updated_at, jobs, imageJobs,
    };
  }

  async act(reelId: string, action: ReelAction): Promise<ReelView> {
    const reel = await this.get(reelId);
    const doc = reel.document;
    const storyboardBase = () => ({ script: doc.script?.lines ?? [], brief: doc.brief ?? null, idea: doc.idea ?? null, references: doc.references ?? [] });

    switch (action.action) {
      case "choose_idea":
        await this.save(reelId, { ...doc, idea: action.idea, script: undefined }, { current_step: "script", title: action.idea.title });
        await this.queue(reelId, "script", "draft", { idea: action.idea, topic: doc.topic ?? "", reference: doc.reference?.url ?? null });
        break;
      case "revise_script":
        if (!doc.script?.lines?.length) throw conflict("no_script", "There is no script to change yet.");
        await this.queue(reelId, "script", "revise", { idea: doc.idea, lines: doc.script.lines, comments: action.comments });
        break;
      case "approve_script": {
        if (!doc.script?.lines?.length) throw conflict("no_script", "There is no script to approve yet.");
        await this.save(reelId, { ...doc, script: { ...doc.script, approved: true }, look: undefined, storyboard: undefined }, { current_step: "storyboard" });
        await this.queueLook(reelId, { ...storyboardBase(), script: doc.script.lines, avoid: [], count: doc.brief?.treatment ? 1 : 3 });
        break;
      }
      case "back_to_script":
        if (!doc.script) throw conflict("no_script", "There is no script to go back to.");
        await this.save(reelId, { ...doc, script: { ...doc.script, approved: false }, look: undefined, storyboard: undefined }, { current_step: "script" });
        break;
      case "choose_look": {
        const chosen = doc.look?.options[action.index];
        if (!chosen) throw conflict("no_look", "That look isn't available any more.");
        await this.save(reelId, { ...doc, look: { ...doc.look!, chosen } }, {});
        await this.queue(reelId, "storyboard", "draft", { phase: "scenes", ...storyboardBase(), look: chosen });
        break;
      }
      case "revise_look": {
        const current = action.index === undefined ? doc.look?.chosen ?? doc.look?.options[0] : doc.look?.options[action.index];
        if (!current) throw conflict("no_look", "There is no look to change yet.");
        await this.save(reelId, { ...doc, look: { ...doc.look!, chosen: undefined } }, {});
        await this.queueLook(reelId, { ...storyboardBase(), current, comments: action.comments, avoid: doc.look?.rejected ?? [], count: 1 }, "revise");
        break;
      }
      case "more_looks": {
        const rejected = [...new Set([...(doc.look?.rejected ?? []), ...(doc.look?.options ?? []).map((look) => look.name)])].slice(-30);
        await this.save(reelId, { ...doc, look: { options: doc.look?.options ?? [], rejected } }, {});
        await this.queueLook(reelId, { ...storyboardBase(), avoid: rejected, count: 3 });
        break;
      }
      case "own_look":
        await this.save(reelId, { ...doc, look: { options: doc.look?.options ?? [], rejected: doc.look?.rejected ?? [] } }, {});
        await this.queueLook(reelId, { ...storyboardBase(), own: action.description, avoid: [], count: 1 });
        break;
      case "revise_storyboard":
        if (!doc.storyboard || !doc.look?.chosen) throw conflict("no_storyboard", "There is no storyboard to change yet.");
        await this.queue(reelId, "storyboard", "revise", {
          phase: "scenes", ...storyboardBase(), look: doc.look.chosen, storyboard: doc.storyboard.scenes.map(sceneText),
          comments: action.comments, scene: action.scene ?? null, image: action.image ?? null,
        });
        break;
      case "edit_image_prompt": {
        const storyboard = doc.storyboard;
        const image = storyboard?.scenes.find((scene) => scene.n === action.scene)?.images.find((item) => item.file === action.file);
        if (!storyboard || !image) throw conflict("no_image", "That image isn't in the storyboard.");
        const scenes = storyboard.scenes.map((scene) => scene.n !== action.scene ? scene
          : { ...scene, images: scene.images.map((item) => item.file === action.file ? { ...item, prompt: action.prompt } : item) });
        await this.save(reelId, { ...doc, storyboard: { ...storyboard, scenes, approved: false } }, {});
        break;
      }
      case "restore_storyboard": {
        const earlier = doc.storyboardHistory?.find((item) => item.version === action.version);
        if (!earlier || !doc.storyboard) throw conflict("no_version", "That version isn't saved any more.");
        const history = [withoutSketches(doc.storyboard), ...(doc.storyboardHistory ?? []).filter((item) => item.version !== action.version)].slice(0, HISTORY);
        const restored = { ...earlier, approved: false, sketchesQueued: undefined };
        await this.save(reelId, { ...doc, storyboard: restored, storyboardHistory: history }, {});
        await this.queueSketches(reelId, { ...doc, storyboard: restored });
        break;
      }
      case "approve_storyboard":
        if (!doc.storyboard?.scenes.length) throw conflict("no_storyboard", "There is no storyboard to approve yet.");
        await this.save(reelId, { ...doc, storyboard: { ...doc.storyboard, approved: true } }, { current_step: "images" });
        break;
      case "redraw_sketches": {
        if (!doc.storyboard?.scenes.length || !doc.look?.chosen) throw conflict("no_storyboard", "There is no storyboard to sketch yet.");
        const only = action.scene ? [action.scene] : doc.storyboard.scenes.map((scene) => scene.n);
        await this.queue(reelId, "storyboard", "render", sketchInput(doc, only), `sketches-${doc.storyboard.version}-${crypto.randomUUID()}`);
        break;
      }
      case "recheck_image": {
        const upload = doc.images?.[action.file];
        if (!upload) throw conflict("no_image", "That image hasn't been uploaded yet.");
        await this.mutate(reelId, (current) => {
          const latest = current.images?.[action.file];
          return latest ? { ...current, images: { ...current.images, [action.file]: { ...latest, review: { status: "pending", notes: "" } } } } : null;
        });
        await this.queueImageReview(reelId, doc, upload);
        break;
      }
      case "continue_images": {
        const missing = imagesToMake(doc.storyboard).filter((image) => !doc.images?.[image.file]);
        if (!doc.storyboard?.approved) throw conflict("no_storyboard", "Approve the storyboard first.");
        if (missing.length) throw conflict("images_missing", `Upload ${missing.map((image) => image.file).join(", ")} first.`);
        await this.save(reelId, doc, { current_step: "voice" });
        if (!doc.voice?.takes.length) await this.queueVoice(reelId, doc, { phase: "takes" });
        break;
      }
      case "choose_take":
        if (!doc.voice?.takes.some((take) => take.id === action.take)) throw conflict("no_take", "That take isn't there any more.");
        await this.save(reelId, { ...doc, voice: { ...doc.voice!, chosen: action.take, approved: false } }, {});
        break;
      case "redo_line": {
        const take = doc.voice?.takes.find((item) => item.id === action.take);
        if (!take) throw conflict("no_take", "That take isn't there any more.");
        await this.save(reelId, { ...doc, voice: { ...doc.voice!, approved: false } }, {});
        await this.queueVoice(reelId, doc, { phase: "line", take: { id: take.id, label: take.label, gap: take.gap, stability: take.stability }, n: action.n, note: action.note }, "revise");
        break;
      }
      case "new_takes":
        await this.save(reelId, { ...doc, voice: { takes: doc.voice?.takes ?? [], credits: doc.voice?.credits } }, {});
        await this.queueVoice(reelId, doc, { phase: "takes" });
        break;
      case "approve_voice":
        if (!doc.voice?.chosen) throw conflict("no_take", "Choose a take first.");
        await this.save(reelId, { ...doc, voice: { ...doc.voice, approved: true } }, { current_step: "build" });
        break;
      case "add_reference":
        await this.save(reelId, { ...doc, references: [...new Set([...(doc.references ?? []), action.url])].slice(-10) }, {});
        break;
      case "remove_reference":
        await this.save(reelId, { ...doc, references: (doc.references ?? []).filter((item) => item !== action.url) }, {});
        break;
      case "retry": {
        const failed = Object.values(reel.jobs).find((job) => job?.status === "failed");
        if (!failed) throw conflict("nothing_to_retry", "There is no failed step to try again.");
        const { data: row, error } = await this.client.from("creative_studio_reel_jobs").select("step,kind,input")
          .eq("id", failed.id).eq("owner_user_id", this.ownerId).maybeSingle();
        if (error || !row) throw unavailable();
        await this.queue(reelId, row.step, row.kind, row.input ?? {});
        break;
      }
    }
    return this.get(reelId);
  }

  /**
   * Folds a finished job's result into the reel document: a script becomes the reel's script, a set of looks
   * becomes the look options, and scenes become the storyboard (the previous one moves to history). Ideas stay
   * on the job. Called when the reel is read, so the runner never writes the document itself.
   */
  async absorb(view: ReelView): Promise<ReelView> {
    if (this.reviewsToFold(view.document, view.imageJobs).length) {
      const document = await this.mutate(view.id, (current) => this.foldReviews(current, view.imageJobs));
      if (document) view = { ...view, document };
    }
    const script = this.absorbScript(view);
    // Storyboard results only count while the reel is on that step: going back to the script clears them.
    // Sketches can also be drawn for a storyboard approved earlier, so those fold in on any later step.
    const sketchesLater = view.currentStep !== "storyboard" && view.jobs.storyboard?.result?.phase === "sketches";
    const storyboard = view.currentStep === "storyboard" || sketchesLater ? this.absorbStoryboard(script ?? view.document, view.jobs.storyboard) : null;
    const voice = view.currentStep === "voice" ? this.absorbVoice(storyboard ?? script ?? view.document, view.jobs.voice) : null;
    let document = voice ?? storyboard ?? script;
    if (!document) return view;
    const queueFor = view.currentStep === "storyboard" ? sketchesToQueue(document) : null;
    if (queueFor) document = { ...document, storyboard: { ...document.storyboard!, sketchesQueued: queueFor } };
    await this.save(view.id, document, {});
    if (queueFor) {
      await this.queueSketches(view.id, document);
      // Read again so the new sketch job is in the view: the page keeps refreshing while a job is active.
      return this.get(view.id);
    }
    return { ...view, document };
  }

  /** Folds finished voice takes in: new takes replace the set; a redone line replaces that one take. */
  private absorbVoice(doc: ReelDocument, job?: ReelJobView): ReelDocument | null {
    if (job?.status !== "needs_review" || !job.result || doc.voice?.fromJob === job.id) return null;
    const takes = z.array(voiceTakeSchema).min(1).max(4).safeParse(job.result.takes);
    if (!takes.success) return null;
    const credits = job.result.credits as ReelVoice["credits"];
    if (job.result.phase === "line") {
      const replaced = (doc.voice?.takes ?? []).map((take) => takes.data.find((item) => item.id === take.id) ?? take);
      return { ...doc, voice: { ...doc.voice, takes: replaced, credits, fromJob: job.id, approved: false } };
    }
    return { ...doc, voice: { takes: takes.data, credits, fromJob: job.id } };
  }

  private async queueVoice(reelId: string, doc: ReelDocument, input: Record<string, unknown>, kind: "draft" | "revise" = "draft") {
    if (!doc.script?.lines.length) throw conflict("no_script", "There is no approved script to voice.");
    await this.queue(reelId, "voice", kind, { ...input, lines: doc.script.lines.map((line) => line.voice) });
  }

  /** Image checks that finished (or failed) for the upload currently on file and aren't in the document yet. */
  private reviewsToFold(doc: ReelDocument, imageJobs: ReelView["imageJobs"] = {}) {
    return Object.values(imageJobs).filter((job) => {
      const upload = Object.values(doc.images ?? {}).find((item) => item.uploadId === job.uploadId);
      return Boolean(upload) && upload!.review.jobId !== job.id && (job.status === "needs_review" || job.status === "failed");
    });
  }

  private foldReviews(doc: ReelDocument, imageJobs: ReelView["imageJobs"]): ReelDocument | null {
    const jobs = this.reviewsToFold(doc, imageJobs);
    if (!jobs.length) return null;
    const images = { ...doc.images };
    for (const job of jobs) {
      const upload = Object.values(images).find((item) => item.uploadId === job.uploadId);
      if (!upload) continue;
      const verdict = job.result?.verdict === "good" ? "good" : job.result?.verdict === "redo" ? "redo" : null;
      const notes = typeof job.result?.notes === "string" ? job.result.notes.slice(0, 500) : "";
      images[upload.file] = { ...upload, review: job.status === "failed" || !verdict
        ? { status: "error", notes: job.progress ?? "The Studio Mac couldn't check this image.", jobId: job.id }
        : { status: verdict, notes, jobId: job.id } };
    }
    return { ...doc, images };
  }

  /** Records an uploaded image (replacing an earlier upload of the same file) and asks the Studio Mac to look at it. */
  async recordUpload(reelId: string, upload: ReelUpload) {
    let replaced: string | null = null;
    const document = await this.mutate(reelId, (doc) => {
      replaced = doc.images?.[upload.file]?.objectPath ?? null;
      return { ...doc, images: { ...doc.images, [upload.file]: upload } };
    });
    if (document) await this.queueImageReview(reelId, document, upload);
    return { replaced: replaced as string | null };
  }

  /** Forgets an uploaded image; returns its storage path so the caller can delete the file. */
  async removeUpload(reelId: string, file: string) {
    let removed: string | null = null;
    await this.mutate(reelId, (doc) => {
      const upload = doc.images?.[file];
      if (!upload) return null;
      removed = upload.objectPath;
      const { [file]: _gone, ...images } = doc.images!;
      return { ...doc, images };
    });
    return removed as string | null;
  }

  /** The storyboard entry for a file the creator has to make, or a clear error. */
  imageToMake(doc: ReelDocument, file: string) {
    const image = imagesToMake(doc.storyboard).find((item) => item.file === file);
    if (!doc.storyboard?.approved) throw conflict("no_storyboard", "Approve the storyboard before uploading images.");
    if (!image) throw conflict("unknown_image", `${file} isn't an image this storyboard asks for.`);
    return image;
  }

  private async queueImageReview(reelId: string, doc: ReelDocument, upload: ReelUpload) {
    const image = imagesToMake(doc.storyboard).find((item) => item.file === upload.file);
    await this.queue(reelId, "images", "draft", {
      phase: "review", file: upload.file, uploadId: upload.uploadId, objectPath: upload.objectPath, mime: upload.mime,
      image: image ?? null, look: doc.look?.chosen ?? null, checks: upload.checks,
    }, `review-${upload.uploadId}-${crypto.randomUUID()}`);
  }

  /**
   * Changes the document from its latest saved state and saves only if nobody saved in between (compared by
   * updated_at), retrying a few times. Used where several requests can land at once, like uploads finishing.
   */
  private async mutate(reelId: string, change: (doc: ReelDocument) => ReelDocument | null): Promise<ReelDocument | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data: row, error } = await this.client.from("creative_studio_reels").select("document,updated_at")
        .eq("id", reelId).eq("owner_user_id", this.ownerId).maybeSingle();
      if (error) throw unavailable();
      if (!row) throw notFound();
      const next = change((row.document ?? {}) as ReelDocument);
      if (!next) return null;
      const updatedAt = new Date().toISOString();
      const { data: saved, error: saveError } = await this.client.from("creative_studio_reels")
        .update({ document: next, updated_at: updatedAt }).eq("id", reelId).eq("owner_user_id", this.ownerId).eq("updated_at", row.updated_at)
        .select("id");
      if (saveError) throw unavailable();
      if (Array.isArray(saved) && saved.length) return next;
    }
    throw new StudioError(409, "reel_busy", "The reel changed while saving. Try again.");
  }

  /** Queues a sketch job for the storyboard's scenes that have no sketch yet. Safe to call twice: the key is per version. */
  private async queueSketches(reelId: string, doc: ReelDocument) {
    const storyboard = doc.storyboard;
    const missing = (storyboard?.scenes ?? []).filter((scene) => !scene.sketch).map((scene) => scene.n);
    if (!storyboard || !missing.length || !doc.look?.chosen) return;
    await this.queue(reelId, "storyboard", "render", sketchInput(doc, missing), `sketches-${storyboard.fromJob ?? "restored"}-v${storyboard.version}-${missing.join(".")}`);
  }

  private absorbScript(view: ReelView): ReelDocument | null {
    const job = view.jobs.script;
    const lines = job?.status === "needs_review" ? job.result?.lines : undefined;
    const parsed = z.array(scriptLineSchema).min(1).max(20).safeParse(lines);
    if (!job || !parsed.success) return null;
    const current = view.document.script;
    if (current && JSON.stringify(current.lines) === JSON.stringify(parsed.data) && !current.approved) return null;
    if (current?.approved && view.currentStep !== "script") return null;
    const notes = typeof job.result?.notes === "string" ? job.result.notes.slice(0, 500) : undefined;
    return { ...view.document, script: { lines: parsed.data, notes, approved: false } };
  }

  private absorbStoryboard(doc: ReelDocument, job?: ReelJobView): ReelDocument | null {
    if (job?.status !== "needs_review" || !job.result) return null;
    if (job.result.phase === "look") {
      if (doc.look?.fromJob === job.id) return null;
      const looks = z.array(lookSchema).min(1).max(3).safeParse(job.result.looks);
      if (!looks.success) return null;
      return { ...doc, look: { options: looks.data, rejected: doc.look?.rejected ?? [], fromJob: job.id } };
    }
    if (job.result.phase === "sketches") {
      const storyboard = doc.storyboard;
      if (!storyboard || storyboard.sketchesFrom === job.id || job.result.version !== storyboard.version) return null;
      const drawn = new Map<number, string>();
      for (const item of Array.isArray(job.result.sketches) ? job.result.sketches : []) {
        const svg = safeSketch(item?.svg);
        if (svg && Number.isInteger(item?.n)) drawn.set(item.n, svg);
      }
      const scenes = storyboard.scenes.map((scene) => (drawn.has(scene.n) ? { ...scene, sketch: drawn.get(scene.n) } : scene));
      return { ...doc, storyboard: { ...storyboard, scenes, sketchesFrom: job.id } };
    }
    if (doc.storyboard?.fromJob === job.id) return null;
    const parsed = z.array(sceneSchema).min(1).max(20).safeParse(job.result.scenes);
    if (!parsed.success) return null;
    const notes = typeof job.result.notes === "string" ? job.result.notes.slice(0, 600) : undefined;
    const previous = doc.storyboard;
    const version = Math.max(previous?.version ?? 0, ...(doc.storyboardHistory ?? []).map((item) => item.version)) + 1;
    // A scene the change left alone keeps its sketch, so only changed scenes are redrawn.
    const scenes = parsed.data.map((scene) => {
      const before = previous?.scenes.find((item) => item.n === scene.n);
      const same = before?.sketch && JSON.stringify(sceneText(before)) === JSON.stringify(sceneText(scene));
      return same ? { ...scene, sketch: before!.sketch } : sceneText(scene);
    });
    return {
      ...doc,
      storyboard: { version, scenes, notes, approved: false, fromJob: job.id },
      storyboardHistory: previous ? [withoutSketches(previous), ...(doc.storyboardHistory ?? [])].slice(0, HISTORY) : doc.storyboardHistory,
    };
  }

  /** Queues the look part of the storyboard, with the treatments already used in the same series to avoid. */
  private async queueLook(reelId: string, input: Record<string, unknown>, kind: "draft" | "revise" = "draft") {
    const series = (input.brief as ReelBrief | null)?.series;
    const used = series ? await this.seriesTreatments(reelId, series) : [];
    await this.queue(reelId, "storyboard", kind, { phase: "look", series: series ?? null, seriesUsed: used, ...input });
  }

  private async seriesTreatments(reelId: string, series: string) {
    const { data, error } = await this.client.from("creative_studio_reels").select("id,document")
      .eq("owner_user_id", this.ownerId).neq("id", reelId).order("updated_at", { ascending: false }).limit(60);
    if (error) throw unavailable();
    const key = series.trim().toLowerCase();
    return (data ?? []).flatMap((row: any) => {
      const doc = (row.document ?? {}) as ReelDocument;
      const chosen = doc.look?.chosen;
      return doc.brief?.series?.trim().toLowerCase() === key && chosen ? [`${chosen.name}: ${chosen.treatment}`.slice(0, 300)] : [];
    }).slice(0, 20);
  }

  private async insert(title: string, step: ReelStep, document: ReelDocument) {
    const { data, error } = await this.client.from("creative_studio_reels").insert({
      owner_user_id: this.ownerId, title: title.slice(0, 200), status: "in_progress", current_step: step, document,
    }).select(REEL_COLUMNS).single();
    if (error || !data) throw unavailable();
    return data as { id: string };
  }

  private async save(reelId: string, document: ReelDocument, extra: Record<string, unknown>) {
    const { error } = await this.client.from("creative_studio_reels")
      .update({ document, updated_at: new Date().toISOString(), ...extra }).eq("id", reelId).eq("owner_user_id", this.ownerId);
    if (error) throw unavailable();
  }

  private async queue(reelId: string, step: ReelStep, kind: "draft" | "revise" | "render" | "mix", input: Record<string, unknown>, key?: string) {
    const { error } = await this.client.from("creative_studio_reel_jobs").insert({
      owner_user_id: this.ownerId, reel_id: reelId, idempotency_key: (key ?? crypto.randomUUID()).slice(0, 200), step, kind, input,
    });
    // 23505: the same keyed job is already queued (two reads absorbed at once). That's the outcome we wanted.
    if (error && error.code !== "23505") throw unavailable();
  }
}
