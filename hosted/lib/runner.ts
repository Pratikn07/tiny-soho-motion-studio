import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { StudioError } from "@/lib/errors";

type DataClient = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
  storage?: { from: (bucket: string) => {
    createSignedUrl: (path: string, seconds: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    createSignedUploadUrl: (path: string, options?: { upsert?: boolean }) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  } };
};

/** How long the Studio Mac's link to an uploaded image works; it is made when the job is claimed. */
const IMAGE_LINK_SECONDS = 15 * 60;

export type RunnerConfig = { token: string; ownerId: string };

/** The Studio Mac runner's secret and the owner it works for. Both are server-only Vercel variables. */
export function readRunnerConfig(env: Record<string, string | undefined> = process.env): RunnerConfig | null {
  const token = env.TINY_SOHO_RUNNER_TOKEN?.trim();
  const ownerId = env.TINY_SOHO_RUNNER_OWNER_ID?.trim();
  if (!token || token.length < 32 || !ownerId || !z.string().uuid().safeParse(ownerId).success) return null;
  return { token, ownerId };
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Checks the runner's bearer token in constant time. */
export function requireRunner(request: Request, config: RunnerConfig | null) {
  if (!config) throw new StudioError(503, "runner_not_configured", "The Studio Mac runner is not set up yet.");
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !timingSafeEqual(digest(token), digest(config.token))) {
    throw new StudioError(401, "invalid_runner_token", "The runner is not allowed.");
  }
  return { ownerId: config.ownerId };
}

export const REEL_STEPS = ["idea", "script", "storyboard", "voice", "images", "build", "sound", "export"] as const;

export const heartbeatSchema = z.object({
  runnerId: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(120),
  claudeAuth: z.enum(["subscription", "api_key"]),
  version: z.string().max(60).optional(),
});

/** A file the runner makes for a job (a voice take), uploaded through a one-time link. */
export const jobFileSchema = z.object({
  leaseId: z.string().uuid(),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,60}$/i),
  mime: z.enum(["audio/mpeg"]),
});

export const claimSchema = z.object({ runnerId: heartbeatSchema.shape.runnerId });

export const jobUpdateSchema = z.object({
  leaseId: z.string().uuid(),
  status: z.enum(["running", "needs_review", "completed", "failed"]).optional(),
  progress: z.string().max(200).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  errorCode: z.string().max(120).optional(),
});

/** A runner counts as online if it checked in within this window (it checks in every 20 s). */
export const ONLINE_WINDOW_MS = 90_000;

export type RunnerState = "not-set-up" | "online" | "asleep";

export function runnerState(lastSeenAt: string | null | undefined, now = Date.now()): RunnerState {
  if (!lastSeenAt) return "not-set-up";
  return now - Date.parse(lastSeenAt) <= ONLINE_WINDOW_MS ? "online" : "asleep";
}

const LEASE_MS = 2 * 60_000;
const unavailable = () => new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");

/** `creative_studio_runners` and `creative_studio_reel_jobs`, as the runner and the owner see them. */
export class RunnerRepository {
  constructor(private client: DataClient, private ownerId: string) {}

  async heartbeat(input: z.infer<typeof heartbeatSchema>, now = new Date()) {
    const { error } = await this.client.from("creative_studio_runners").upsert({
      id: input.runnerId,
      owner_user_id: this.ownerId,
      label: input.label,
      claude_auth: input.claudeAuth,
      version: input.version ?? null,
      last_seen_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: "id" });
    if (error) throw unavailable();
  }

  /** Claims the oldest available job and returns it with its reel, or null when the queue is empty. */
  async claim(runnerId: string) {
    const { data, error } = await this.client.rpc("claim_creative_studio_reel_job", { runner: runnerId });
    if (error) throw unavailable();
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.id) return null;
    const { data: reel, error: reelError } = await this.client.from("creative_studio_reels")
      .select("id,title,current_step,document,revision").eq("id", job.reel_id).maybeSingle();
    if (reelError) throw unavailable();
    return { job: await this.withImageLink(publicJob(job)), reel };
  }

  /** An image check gets a fresh link to the uploaded image, only for a file in this owner's reel folder. */
  private async withImageLink(job: ReturnType<typeof publicJob>) {
    const path = job.step === "images" ? job.input?.objectPath : null;
    if (typeof path !== "string" || !path.startsWith(`owners/${this.ownerId}/reels/${job.reelId}/images/`) || !this.client.storage) return job;
    const { data } = await this.client.storage.from("creative-studio").createSignedUrl(path, IMAGE_LINK_SECONDS);
    return data?.signedUrl ? { ...job, input: { ...job.input, imageUrl: data.signedUrl } } : job;
  }

  /** A one-time upload link for a file the job made, only while the runner holds the job, into that reel's folder. */
  async jobFileUpload(jobId: string, input: z.infer<typeof jobFileSchema>) {
    const { data: job, error } = await this.client.from("creative_studio_reel_jobs").select("id,reel_id,step,status,worker_lease_id")
      .eq("id", jobId).eq("owner_user_id", this.ownerId).maybeSingle();
    if (error) throw unavailable();
    if (!job || job.status !== "running" || job.worker_lease_id !== input.leaseId) {
      throw new StudioError(409, "lease_lost", "This job is no longer held by this runner.");
    }
    if (job.step !== "voice" || !this.client.storage) throw new StudioError(400, "no_files", "This step doesn't upload files.");
    const objectPath = `owners/${this.ownerId}/reels/${job.reel_id}/voice/${job.id}-${input.name}`;
    const { data, error: signError } = await this.client.storage.from("creative-studio").createSignedUploadUrl(objectPath, { upsert: false });
    if (signError || !data?.signedUrl) throw new StudioError(502, "upload_unavailable", "Uploads are temporarily unavailable.");
    return { uploadUrl: data.signedUrl, objectPath };
  }

  /** Records progress or a result. The lease must match; a running update renews it for two more minutes. */
  async updateJob(jobId: string, input: z.infer<typeof jobUpdateSchema>, now = new Date()) {
    const patch: Record<string, unknown> = { updated_at: now.toISOString() };
    if (input.progress !== undefined) patch.progress = input.progress;
    if (input.result !== undefined) patch.result = input.result;
    if (input.errorCode !== undefined) patch.error_code = input.errorCode;
    if (input.status) patch.status = input.status;
    if (!input.status || input.status === "running") {
      patch.worker_lease_expires_at = new Date(now.getTime() + LEASE_MS).toISOString();
    } else {
      patch.worker_lease_id = null;
      patch.worker_lease_expires_at = null;
      patch.completed_at = now.toISOString();
    }
    const { data, error } = await this.client.from("creative_studio_reel_jobs").update(patch)
      .eq("id", jobId).eq("worker_lease_id", input.leaseId).eq("status", "running").select("id,status").maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new StudioError(409, "lease_lost", "This job is no longer held by the runner.");
    return data as { id: string; status: string };
  }

  /** What the Studio Mac chip shows: the most recent runner and the queue. */
  async status(now = Date.now()) {
    const { data: runners, error } = await this.client.from("creative_studio_runners")
      .select("id,label,claude_auth,last_seen_at").eq("owner_user_id", this.ownerId)
      .order("last_seen_at", { ascending: false, nullsFirst: false }).limit(1);
    if (error) throw unavailable();
    const { data: jobs, error: jobsError } = await this.client.from("creative_studio_reel_jobs")
      .select("status").eq("owner_user_id", this.ownerId).in("status", ["queued", "running"]);
    if (jobsError) throw unavailable();
    const runner = runners?.[0] ?? null;
    const list = (jobs ?? []) as Array<{ status: string }>;
    return {
      state: runnerState(runner?.last_seen_at, now),
      label: runner?.label ?? null,
      claudeAuth: runner?.claude_auth ?? null,
      lastSeenAt: runner?.last_seen_at ?? null,
      queue: { queued: list.filter((job) => job.status === "queued").length, running: list.filter((job) => job.status === "running").length },
    };
  }
}

function publicJob(job: Record<string, any>) {
  return {
    id: job.id as string,
    reelId: job.reel_id as string,
    step: job.step as (typeof REEL_STEPS)[number],
    kind: job.kind as string,
    input: (job.input ?? {}) as Record<string, unknown>,
    leaseId: job.worker_lease_id as string,
    attempt: job.attempt_count as number,
  };
}
