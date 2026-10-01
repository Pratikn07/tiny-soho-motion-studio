import { budgetResponseSchema, DEFAULT_MONTHLY_CAP_USD, type BudgetResponse } from "@/lib/contract";
import { StudioError } from "@/lib/errors";
import type { Owner } from "@/lib/types";

type Client = { from: (table: string) => any };
type Result<T> = { data: T | null; error: unknown };

const VIDEO_PROVIDERS = new Set(["modal-ltx", "alibaba"]);
const MODAL_CREDIT_NOTE = "Modal's $30 monthly credit is not guaranteed and is not counted here.";

/** `TINY_SOHO_MONTHLY_CAP_USD`, default $50 (the worker reads the same variable). Unreadable means $0. */
export function monthlyCapUsd(env: Record<string, string | undefined> = process.env) {
  const raw = env.TINY_SOHO_MONTHLY_CAP_USD?.trim();
  if (!raw) return DEFAULT_MONTHLY_CAP_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

const money = (value: number) => Math.round(value * 10_000) / 10_000;
const rows = <T>(result: Result<T[]>) => {
  if (result.error) throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
  return result.data ?? [];
};

/** Month-to-date spend (UTC month) by provider, open reservations, the cap, and cost per accepted clip. */
export async function budgetView(client: Client, owner: Owner, capUsd: number, now = new Date()): Promise<BudgetResponse> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const spend = rows(await client.from("creative_studio_spend").select("provider,usd,gpu_seconds,job_id")
    .eq("owner_user_id", owner.userId).gte("occurred_at", monthStart) as Result<Array<{
      provider: string; usd: number | string; gpu_seconds: number | string | null; job_id: string | null;
    }>>);
  const reservations = rows(await client.from("creative_studio_budget_reservations").select("usd")
    .eq("owner_user_id", owner.userId).eq("status", "open") as Result<Array<{ usd: number | string }>>);
  const accepted = rows(await client.from("creative_studio_takes").select("id")
    .eq("owner_user_id", owner.userId).eq("verdict", "accepted").gte("created_at", monthStart) as Result<Array<{ id: string }>>);

  const byProvider = new Map<string, { usd: number; gpuSeconds: number | null; clips: number }>();
  for (const row of spend) {
    const entry = byProvider.get(row.provider) ?? { usd: 0, gpuSeconds: null, clips: 0 };
    entry.usd += Number(row.usd);
    if (row.gpu_seconds !== null) entry.gpuSeconds = (entry.gpuSeconds ?? 0) + Number(row.gpu_seconds);
    if (row.job_id && VIDEO_PROVIDERS.has(row.provider)) entry.clips += 1;
    byProvider.set(row.provider, entry);
  }
  const spentUsd = money(spend.reduce((sum, row) => sum + Number(row.usd), 0));
  const reservedUsd = money(reservations.reduce((sum, row) => sum + Number(row.usd), 0));
  return budgetResponseSchema.parse({
    month: monthStart.slice(0, 7),
    capUsd,
    spentUsd,
    reservedUsd,
    remainingUsd: money(Math.max(0, capUsd - spentUsd - reservedUsd)),
    byProvider: [...byProvider].map(([provider, entry]) => ({
      provider,
      usd: money(entry.usd),
      gpuSeconds: entry.gpuSeconds === null ? null : Math.round(entry.gpuSeconds * 10) / 10,
      clips: entry.clips,
    })),
    clipsAccepted: accepted.length,
    costPerAcceptedClipUsd: accepted.length ? money(spentUsd / accepted.length) : null,
    notes: [MODAL_CREDIT_NOTE],
  });
}

/**
 * Refuses up front when the next take clearly won't fit, so the creator sees why before anything is queued.
 * The worker's locked reservation is still the real gate.
 */
export async function assertBudgetFor(client: Client, owner: Owner, estimatedUsd: number, capUsd = monthlyCapUsd()) {
  const budget = await budgetView(client, owner, capUsd);
  if (budget.remainingUsd + 1e-9 < estimatedUsd) {
    throw new StudioError(
      400,
      "budget_exceeded",
      `This take would go over this month's $${capUsd.toFixed(2)} budget ($${budget.remainingUsd.toFixed(2)} left). Nothing was charged.`,
    );
  }
  return budget;
}

/** Ledger row for a paid AI review (free reviewers record nothing). Unique per review run. */
export async function recordReviewSpend(client: Client, owner: Owner, review: {
  id: string; provider: string; model: string; costUsd: number | null;
}) {
  if (!review.costUsd) return;
  const inserted = await client.from("creative_studio_spend").insert({
    owner_user_id: owner.userId,
    provider: review.provider,
    model_id: review.model,
    review_run_id: review.id,
    usd: review.costUsd,
  }) as { error: { code?: string } | null };
  if (inserted.error && inserted.error.code !== "23505") {
    throw new StudioError(500, "studio_database_error", "Studio data is temporarily unavailable.");
  }
}
