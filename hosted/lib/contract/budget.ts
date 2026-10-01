import { z } from "zod";

export const DEFAULT_MONTHLY_CAP_USD = 50;

const billingAmounts = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  usageUsd: z.number().finite().nonnegative(),
  creditsAppliedUsd: z.number().finite().nonnegative(),
  billedUsd: z.number().finite().nonnegative(),
  updatedAt: z.string().datetime(),
});
export const modalBillingSchema = z.union([
  billingAmounts.extend({ status: z.enum(["fresh", "stale"]) }),
  z.object({ status: z.literal("unavailable"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
]).refine((billing) => billing.status === "unavailable"
  || Math.abs(billing.usageUsd - billing.creditsAppliedUsd - billing.billedUsd) < 0.000001,
  "Modal usage equals billed amount plus applied credits.");
export type ModalBilling = z.infer<typeof modalBillingSchema>;

/** `GET /api/budget` (O1). Money in USD, month in UTC. */
export const budgetResponseSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    capUsd: z.number().nonnegative(),
    spentUsd: z.number().nonnegative(),
    reservedUsd: z.number().nonnegative(),
    remainingUsd: z.number().nonnegative(),
    byProvider: z.array(
      z.object({
        provider: z.string().trim().min(1).max(40),
        usd: z.number().nonnegative(),
        gpuSeconds: z.number().nonnegative().nullable(),
        clips: z.number().int().min(0),
      }),
    ),
    clipsAccepted: z.number().int().min(0),
    costPerAcceptedClipUsd: z.number().nonnegative().nullable(),
    modalBilling: modalBillingSchema.optional(),
    notes: z.array(z.string().trim().min(1).max(300)).max(5),
  })
  .refine(
    (budget) => Math.abs(budget.remainingUsd - Math.max(0, budget.capUsd - budget.spentUsd - budget.reservedUsd)) < 0.005,
    "remainingUsd = max(0, cap - spent - reserved).",
  );
export type BudgetResponse = z.infer<typeof budgetResponseSchema>;

/** `creative_studio_spend` ledger row: one per paid call, written once (unique per job and per review run). */
export type SpendRow = {
  id: string;
  owner_user_id: string;
  provider: string;
  model_id: string;
  job_id: string | null;
  take_id: string | null;
  review_run_id: string | null;
  usd: number;
  gpu_seconds: number | null;
  video_seconds: number | null;
  occurred_at: string;
  created_at: string;
};
