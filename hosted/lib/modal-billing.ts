import { createHmac } from "node:crypto";
import { modalBillingSchema, type ModalBilling } from "@/lib/contract";

/** Read-only worker proxy. Modal tokens never belong in this Vercel application. */
export async function modalBillingFor(month: string, env: Record<string, string | undefined> = process.env): Promise<ModalBilling> {
  const unavailable = { status: "unavailable" as const, month };
  const base = env.CREATIVE_WORKER_BILLING_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return unavailable;
  try {
    const origin = new URL(base);
    if (origin.protocol !== "https:" || origin.username || origin.password) return unavailable;
    const url = new URL("/billing/modal", origin);
    url.searchParams.set("month", month);
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", key).update(`GET\n${url.pathname}${url.search}\n${timestamp}`).digest("hex");
    const response = await fetch(url, {
      headers: { "x-tiny-soho-billing-timestamp": timestamp, "x-tiny-soho-billing-signature": signature },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return unavailable;
    const billing = modalBillingSchema.parse(await response.json());
    return billing.month === month ? billing : unavailable;
  } catch { return unavailable; }
}
