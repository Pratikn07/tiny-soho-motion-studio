import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

type Amounts = { usageUsd: number; creditsAppliedUsd: number; billedUsd: number };
export type ModalBilling = ({ status: "fresh" | "stale"; month: string; updatedAt: string } & Amounts)
  | { status: "unavailable"; month: string };
const exec = promisify(execFile);
const cycle = (now: number) => new Date(now).toISOString().slice(0, 7);

/** Documented Python SDK billing read; tokens are environment-only, never command arguments. */
export async function readModalSummary(month: string): Promise<Amounts> {
  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) throw new Error("Billing unavailable");
  const { stdout } = await exec(process.env.MODAL_BILLING_PYTHON || "/opt/modal-billing/bin/python", [
    fileURLToPath(new URL("./modal_billing.py", import.meta.url)), month,
  ], {
    timeout: 12_000, killSignal: "SIGKILL", maxBuffer: 16_384,
    env: { PATH: process.env.PATH, MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
      MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET },
  });
  return JSON.parse(stdout) as Amounts;
}

export function createModalBillingService(options: {
  readSummary: (month: string) => Promise<Amounts>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let cached: ModalBilling | undefined;
  let attemptedAt = 0;
  let pending: { month: string; result: Promise<ModalBilling> } | undefined;
  return {
    async get(): Promise<ModalBilling> {
      const month = cycle(now());
      if (cached?.month === month && now() - attemptedAt < 60_000) return cached;
      if (pending?.month === month) return pending.result;
      const result = (async (): Promise<ModalBilling> => {
        try {
          const amounts = await options.readSummary(month);
          if (![amounts.usageUsd, amounts.creditsAppliedUsd, amounts.billedUsd].every((value) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0)
            || Math.abs(amounts.usageUsd - amounts.creditsAppliedUsd - amounts.billedUsd) > 0.000001) {
            throw new Error("Invalid billing summary");
          }
          cached = { status: "fresh", month, updatedAt: new Date(now()).toISOString(),
            usageUsd: amounts.usageUsd, creditsAppliedUsd: amounts.creditsAppliedUsd, billedUsd: amounts.billedUsd };
        } catch {
          cached = cached?.month === month && cached.status !== "unavailable"
            ? { ...cached, status: "stale" } : { status: "unavailable", month };
        }
        attemptedAt = now();
        return cached;
      })();
      pending = { month, result };
      try { return await result; } finally { if (pending?.result === result) pending = undefined; }
    },
  };
}

/** Owner-gated hosted server signs reads using the existing shared Supabase server key.
 * The signature is bound to the URL and a short time window; the key itself is never transmitted. */
export async function modalBillingResponse(request: {
  method?: string; url?: string; headers: Record<string, string | string[] | undefined>;
}, options: { key?: string; service: ReturnType<typeof createModalBillingService>; now?: () => number }) {
  const url = request.url ?? "";
  if (!url.startsWith("/billing/modal")) return null;
  const now = (options.now ?? Date.now)();
  const timestamp = request.headers["x-tiny-soho-billing-timestamp"];
  const signature = request.headers["x-tiny-soho-billing-signature"];
  if (request.method !== "GET" || !options.key || typeof timestamp !== "string" || !/^\d{13}$/.test(timestamp)
    || Math.abs(now - Number(timestamp)) > 60_000 || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) {
    return { status: 401, body: { error: "billing_auth_required" } };
  }
  const expected = createHmac("sha256", options.key).update(`GET\n${url}\n${timestamp}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return { status: 401, body: { error: "billing_auth_required" } };
  const parsed = new URL(url, "http://worker.internal");
  if (parsed.pathname !== "/billing/modal" || parsed.searchParams.get("month") !== cycle(now)
    || [...parsed.searchParams].length !== 1) return { status: 400, body: { error: "billing_cycle_invalid" } };
  return { status: 200, body: await options.service.get() };
}
