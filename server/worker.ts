import fs from "node:fs/promises";
import path from "node:path";
import { store } from "../lib/store";
import { submitAlibabaJob, checkAlibabaTask } from "../lib/provider";
import { downloadProviderAsset, saveAsset } from "../lib/assets";
import { executeWorkflowRun } from "../lib/workflows";

const db = store();
async function outputFor(job: ReturnType<typeof db.getJob>, url: string) {
  if (!job) return;
  const download = await downloadProviderAsset(url);
  const saved = await saveAsset(download.bytes, "generated", download.mime);
  const asset = db.addAsset({ projectId: job.projectId, kind: download.mime.startsWith("image/") ? "image" : "video", name: "Generated output", mime: download.mime, path: saved.path, width: saved.width, height: saved.height, duration: saved.duration, hash: saved.hash, provenance: JSON.stringify({ jobId: job.id, providerTaskId: job.providerTaskId }) });
  db.updateJob(job.id, { status: "completed", outputAssetId: asset.id });
}
async function tick() {
  const confirmed = new Set(db.getSetting<string[]>("freeQuotaModels") || []);
  for (const run of db.listWorkflowRuns()) { const state = JSON.parse(run.state) as { status?: string }; if (state.status === "running") executeWorkflowRun(db, run.id, confirmed); }
  const active = db.listJobs().filter((job) => job.status === "submitted" || job.status === "running");
  for (const job of active) {
    if (!job.providerTaskId) continue;
    try { const state = await checkAlibabaTask(job.providerTaskId); if (state.status === "SUCCEEDED" && state.outputUrl) { db.updateJob(job.id, { status: "downloading" }); await outputFor(job, state.outputUrl); } else if (["FAILED", "CANCELED", "UNKNOWN"].includes(state.status)) db.updateJob(job.id, { status: state.status === "UNKNOWN" ? "needs_attention" : "failed", error: state.error || state.status }); else db.updateJob(job.id, { status: "running" }); } catch (error) { db.updateJob(job.id, { status: "needs_attention", error: error instanceof Error ? error.message : "Polling failed" }); }
  }
  const job = db.claimNextJob();
  if (!job) return;
  try {
    const assets = JSON.parse(job.inputAssetIds) as string[]; const options = JSON.parse(job.options) as { media?: Array<{ assetId?: string; role?: string }>; inputRoles?: string[] };
    const roles = options.media?.map((media) => media.role) || options.inputRoles;
    if (!roles || roles.length !== assets.length || roles.some((role) => typeof role !== "string")) throw new Error("Job is missing explicit media roles and cannot be submitted safely.");
    const inputs = await Promise.all(assets.map(async (assetId, index) => { const asset = db.getAsset(assetId); if (!asset) throw new Error("Referenced asset is missing."); return { mime: asset.mime, bytes: await fs.readFile(asset.path), role: roles[index] as string }; }));
    const result = await submitAlibabaJob(job, inputs);
    if (result.outputUrl) { db.updateJob(job.id, { status: "downloading" }); await outputFor(job, result.outputUrl); } else db.updateJob(job.id, { status: "submitted", providerTaskId: result.providerTaskId });
  } catch (error) { db.updateJob(job.id, { status: "failed", error: error instanceof Error ? error.message : "Submission failed" }); }
}
setInterval(() => { void tick(); }, 15_000); void tick();
console.log("Tiny Soho worker running; polling every 15 seconds.");
