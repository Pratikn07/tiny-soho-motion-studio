import { store } from "../lib/store";
import { submitAlibabaJob, checkAlibabaTask } from "../lib/provider";
import { adoptProviderDownload, downloadProviderAsset } from "../lib/assets";
import { resolveJobMedia } from "../lib/job-media";
import { providerOutputProvenance } from "../lib/media-transport/provider-output";
import { executeWorkflowRun } from "../lib/workflows";
import { createSingleFlightRunner } from "../lib/worker-loop";

const db = store();

async function retrySafe<T>(operation: () => Promise<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1) + Math.floor(Math.random() * 100)));
    }
  }
  throw lastError;
}

async function outputFor(job: NonNullable<ReturnType<typeof db.getJob>>, url: string) {
  const download = await retrySafe(() => downloadProviderAsset(url));
  const processing = db.transitionJob(job.id, ["downloading"], { status: "processing" });
  if (!processing) return;
  const saved = await adoptProviderDownload(download);
  const jobOptions = JSON.parse(job.options) as { internalProvenance?: Record<string, unknown> };
  const asset = db.addAsset({
    projectId: job.projectId,
    kind: download.mime.startsWith("image/") ? "image" : "video",
    name: "Generated output",
    mime: download.mime,
    path: saved.path,
    width: saved.width,
    height: saved.height,
    duration: saved.duration,
    hash: saved.hash,
    provenance: JSON.stringify({ jobId: job.id, providerTaskId: job.providerTaskId, providerOutput: providerOutputProvenance(url), media: { codec: saved.codec, container: saved.container }, ...(jobOptions.internalProvenance ? { internalProvenance: jobOptions.internalProvenance } : {}) }),
  });
  db.transitionJob(job.id, ["processing"], { status: "completed", outputAssetId: asset.id, error: null });
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function pollActiveJobs() {
  const active = db.listJobs().filter((job) => job.status === "submitted" || job.status === "running");
  for (const job of active) {
    if (!job.providerTaskId) {
      db.transitionJob(job.id, ["submitted", "running"], { status: "needs_attention", error: "Provider task ID is missing; automatic recovery is unsafe." });
      continue;
    }
    try {
      const state = await retrySafe(() => checkAlibabaTask(job.providerTaskId!));
      if (state.status === "SUCCEEDED" && state.outputUrl) {
        const downloading = db.transitionJob(job.id, ["submitted", "running"], { status: "downloading", error: null });
        if (downloading) await outputFor(downloading, state.outputUrl);
      } else if (state.status === "SUCCEEDED") {
        db.transitionJob(job.id, ["submitted", "running"], { status: "needs_attention", error: "Provider reported success without a result URL." });
      } else if (["FAILED", "CANCELED", "UNKNOWN"].includes(state.status)) {
        const status = state.status === "UNKNOWN" ? "needs_attention" : state.status === "CANCELED" ? "canceled" : "failed";
        db.transitionJob(job.id, ["submitted", "running"], { status, error: state.error || state.status });
      } else {
        db.transitionJob(job.id, ["submitted", "running"], { status: "running", error: null });
      }
    } catch (error) {
      db.transitionJob(job.id, ["submitted", "running", "downloading", "processing"], { status: "needs_attention", error: failureMessage(error, "Polling or local result handling failed") });
    }
  }
}

async function submitQueuedJob() {
  const job = db.claimNextJob();
  if (!job) return;
  let resolved;
  try {
    resolved = await resolveJobMedia(db, job);
  } catch (error) {
    db.transitionJob(job.id, ["preparing_media"], { status: "failed", error: failureMessage(error, "Job media preparation failed") });
    return;
  }
  if (!resolved.ok) {
    db.transitionJob(job.id, ["preparing_media"], { status: "failed", error: resolved.reason });
    return;
  }
  const submitting = db.transitionJob(job.id, ["preparing_media"], { status: "submitting", error: null });
  if (!submitting) return;

  try {
    const result = await submitAlibabaJob(submitting, resolved.media);
    if (result.outputUrl) {
      const downloading = db.transitionJob(job.id, ["submitting"], { status: "downloading", error: null });
      if (downloading) {
        try {
          await outputFor(downloading, result.outputUrl);
        } catch (error) {
          db.transitionJob(job.id, ["downloading", "processing"], { status: "needs_attention", error: failureMessage(error, "Local result handling failed") });
        }
      }
    } else {
      db.transitionJob(job.id, ["submitting"], { status: "submitted", providerTaskId: result.providerTaskId, error: null });
    }
  } catch (error) {
    db.transitionJob(job.id, ["submitting"], { status: "submission_unknown", error: `Provider submission was not retried because acceptance is unknown: ${failureMessage(error, "submission failed")}` });
  }
}

async function tick() {
  const confirmed = new Set(db.getSetting<string[]>("freeQuotaModels") || []);
  for (const run of db.listWorkflowRuns()) {
    const state = JSON.parse(run.state) as { status?: string };
    if (state.status === "running") executeWorkflowRun(db, run.id, confirmed);
  }
  await pollActiveJobs();
  await submitQueuedJob();
}

db.reconcileInterruptedJobs();
const runTick = createSingleFlightRunner(tick);
setInterval(() => { void runTick(); }, 15_000);
void runTick();
console.log("Tiny Soho worker running; polling every 15 seconds.");
