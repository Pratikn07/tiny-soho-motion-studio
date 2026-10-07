import { z } from "zod";

import { StudioError } from "@/lib/errors";

type DataClient = { from: (table: string) => any };

export const REEL_STEPS = ["idea", "script", "storyboard", "voice", "images", "build", "sound", "export"] as const;
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

export const createReelSchema = z.object({
  topic: z.string().trim().max(400).default(""),
  title: z.string().trim().max(200).optional(),
});

export const reelActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("choose_idea"), idea: ideaSchema }),
  z.object({ action: z.literal("revise_script"), comments: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("approve_script") }),
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
  idea?: ReelIdea;
  script?: { lines: ScriptLine[]; notes?: string; approved?: boolean };
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
const REEL_COLUMNS = "id,title,status,current_step,document,revision,updated_at";
const JOB_COLUMNS = "id,step,kind,status,progress,error_code,result,input,created_at,updated_at";

function jobView(row: Record<string, any>): ReelJobView {
  return {
    id: row.id, step: row.step, kind: row.kind, status: row.status, progress: row.progress ?? null,
    errorCode: row.error_code ?? null, result: row.result ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
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

  /** Creates a reel and queues its first job: three story ideas for the topic. */
  async create(input: z.infer<typeof createReelSchema>): Promise<ReelView> {
    const title = input.title || (input.topic ? input.topic.slice(0, 80) : "New reel");
    const { data, error } = await this.client.from("creative_studio_reels").insert({
      owner_user_id: this.ownerId, title, status: "in_progress", current_step: "idea", document: { topic: input.topic },
    }).select(REEL_COLUMNS).single();
    if (error || !data) throw unavailable();
    await this.queue(data.id, "idea", "draft", { topic: input.topic });
    return this.get(data.id);
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
    if (action.action === "choose_idea") {
      await this.save(reelId, { ...doc, idea: action.idea, script: undefined }, { current_step: "script", title: action.idea.title });
      await this.queue(reelId, "script", "draft", { idea: action.idea, topic: doc.topic ?? "" });
    } else if (action.action === "revise_script") {
      if (!doc.script?.lines?.length) throw new StudioError(409, "no_script", "There is no script to change yet.");
      await this.queue(reelId, "script", "revise", { idea: doc.idea, lines: doc.script.lines, comments: action.comments });
    } else if (action.action === "approve_script") {
      if (!doc.script?.lines?.length) throw new StudioError(409, "no_script", "There is no script to approve yet.");
      await this.save(reelId, { ...doc, script: { ...doc.script, approved: true } }, { current_step: "storyboard" });
    } else {
      const failed = Object.values(reel.jobs).find((job) => job?.status === "failed");
      if (!failed) throw new StudioError(409, "nothing_to_retry", "There is no failed step to try again.");
      const { data: row, error } = await this.client.from("creative_studio_reel_jobs").select("step,kind,input")
        .eq("id", failed.id).eq("owner_user_id", this.ownerId).maybeSingle();
      if (error || !row) throw unavailable();
      await this.queue(reelId, row.step, row.kind, row.input ?? {});
    }
    return this.get(reelId);
  }

  /**
   * Folds a finished job's result into the reel document (ideas stay on the job; a script becomes the reel's
   * current script). Called when the reel is read, so the runner never writes the document itself.
   */
  async absorb(view: ReelView): Promise<ReelView> {
    const job = view.jobs.script;
    const lines = job?.status === "needs_review" ? job.result?.lines : undefined;
    const parsed = z.array(scriptLineSchema).min(1).max(20).safeParse(lines);
    if (!job || !parsed.success) return view;
    const current = view.document.script;
    if (current && JSON.stringify(current.lines) === JSON.stringify(parsed.data) && !current.approved) return view;
    if (current?.approved && view.currentStep !== "script") return view;
    const notes = typeof job.result?.notes === "string" ? job.result.notes.slice(0, 500) : undefined;
    const document = { ...view.document, script: { lines: parsed.data, notes, approved: false } };
    await this.save(view.id, document, {});
    return { ...view, document };
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
