import { hasClaimedId } from "../claim.js";
import type { PipelineRunRow } from "../contract.js";
import type { WorkerClient } from "../worker.js";
import { RunStopped, advanceRun, type PipelineDependencies } from "./steps.js";

/** Claims one due pipeline run and advances it by one step. Returns true when a run was claimed. */
export async function runPipelineTick(client: WorkerClient, dependencies: PipelineDependencies) {
  const claimed = await client.rpc("claim_creative_studio_pipeline_run");
  if (claimed.error) throw new Error("pipeline_run_claim_failed");
  if (!hasClaimedId(claimed.data)) return false;
  try {
    await advanceRun(claimed.data as PipelineRunRow, dependencies);
  } catch (error) {
    if (!(error instanceof RunStopped)) throw error;
  }
  return true;
}
