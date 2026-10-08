import { z } from "zod";

import { StudioError } from "@/lib/errors";
import { briefIsUsable, parseBrief, type ReelBrief } from "@/lib/reel-brief";

type DataClient = { from: (table: string) => any };

/** The steps in the order the creator works through them. Images come before Voice: they follow the storyboard. */
export const REEL_STEPS = ["idea", "script", "storyboard", "images", "voice", "build", "sound", "export"] as const;
export type ReelStep = (typeof REEL_STEPS)[number];

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
});
export type ReelScene = z.infer<typeof sceneSchema>;

export type ReelStoryboard = { version: number; scenes: ReelScene[]; notes?: string; approved?: boolean; fromJob?: string };

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

/** Every image the storyboard asks for, in scene order. */
export function storyboardImages(storyboard?: ReelStoryboard) {
  return (storyboard?.scenes ?? []).flatMap((scene) => scene.images.map((image) => ({ scene: scene.n, ...image })));
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
    for (const row of rows ?? []) if (!jobs[row.step as ReelStep]) jobs[row.step as ReelStep] = jobView(row);
    return {
      id: reel.id, title: reel.title, status: reel.status, currentStep: reel.current_step,
      document: (reel.document ?? {}) as ReelDocument, updatedAt: reel.updated_at, jobs,
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
          phase: "scenes", ...storyboardBase(), look: doc.look.chosen, storyboard: doc.storyboard.scenes,
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
        const history = [doc.storyboard, ...(doc.storyboardHistory ?? []).filter((item) => item.version !== action.version)].slice(0, HISTORY);
        await this.save(reelId, { ...doc, storyboard: { ...earlier, approved: false }, storyboardHistory: history }, {});
        break;
      }
      case "approve_storyboard":
        if (!doc.storyboard?.scenes.length) throw conflict("no_storyboard", "There is no storyboard to approve yet.");
        await this.save(reelId, { ...doc, storyboard: { ...doc.storyboard, approved: true } }, { current_step: "images" });
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
    const script = this.absorbScript(view);
    // Storyboard results only count while the reel is on that step: going back to the script clears them.
    const storyboard = view.currentStep === "storyboard" ? this.absorbStoryboard(script ?? view.document, view.jobs.storyboard) : null;
    const document = storyboard ?? script;
    if (!document) return view;
    await this.save(view.id, document, {});
    return { ...view, document };
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
    if (doc.storyboard?.fromJob === job.id) return null;
    const scenes = z.array(sceneSchema).min(1).max(20).safeParse(job.result.scenes);
    if (!scenes.success) return null;
    const notes = typeof job.result.notes === "string" ? job.result.notes.slice(0, 600) : undefined;
    const previous = doc.storyboard;
    const version = Math.max(previous?.version ?? 0, ...(doc.storyboardHistory ?? []).map((item) => item.version)) + 1;
    return {
      ...doc,
      storyboard: { version, scenes: scenes.data, notes, approved: false, fromJob: job.id },
      storyboardHistory: previous ? [previous, ...(doc.storyboardHistory ?? [])].slice(0, HISTORY) : doc.storyboardHistory,
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

  private async queue(reelId: string, step: ReelStep, kind: "draft" | "revise" | "render" | "mix", input: Record<string, unknown>) {
    const { error } = await this.client.from("creative_studio_reel_jobs").insert({
      owner_user_id: this.ownerId, reel_id: reelId, idempotency_key: crypto.randomUUID(), step, kind, input,
    });
    if (error) throw unavailable();
  }
}
