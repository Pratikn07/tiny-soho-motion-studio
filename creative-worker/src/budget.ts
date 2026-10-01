import type { PipelineDependencies } from "./pipeline/steps.js";
import { MODEL_CLIP_USD } from "./router.js";

export const DEFAULT_MONTHLY_CAP_USD = 50;

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => any };

/** `TINY_SOHO_MONTHLY_CAP_USD`, default $50. An unreadable value falls back to $0: nothing is spent. */
export function monthlyCapUsd(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.TINY_SOHO_MONTHLY_CAP_USD?.trim();
  if (!raw) return DEFAULT_MONTHLY_CAP_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Reserves a take's estimated cost under the owner's monthly cap before any provider call. Idempotent per key;
 * the database lock stops two takes from both passing the last dollars.
 */
export function budgetReserver(client: RpcClient, capUsd: number): PipelineDependencies["reserveBudget"] {
  return async (run, key, modelId) => {
    const usd = MODEL_CLIP_USD[modelId];
    if (usd === undefined) return false;
    const result = await client.rpc("reserve_creative_studio_budget", {
      p_owner_user_id: run.owner_user_id,
      p_reservation_key: key,
      p_run_id: run.id,
      p_usd: usd,
      p_cap_usd: capUsd,
    });
    if (result.error) throw new Error("budget_reserve_failed");
    return result.data === true;
  };
}

/** Writes a finished job's measured cost to the ledger once and settles its reservation. */
export async function settleJobSpend(client: RpcClient, jobId: string) {
  const result = await client.rpc("settle_creative_studio_job_spend", { p_job_id: jobId });
  if (result.error) throw new Error("budget_settle_failed");
  return result.data as string;
}
