import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modalBillingFor } from "@/lib/modal-billing";

const month = "2026-10";
const env = { CREATIVE_WORKER_BILLING_URL: "https://worker.test", SUPABASE_SERVICE_ROLE_KEY: "test-signing-key" };
const billing = { status: "fresh", month, usageUsd: 0.35, creditsAppliedUsd: 0.35, billedUsd: 0, updatedAt: "2026-10-01T19:00:00.000Z" };
afterEach(() => vi.unstubAllGlobals());

describe("Modal billing proxy", () => {
  it("signs only a read request, disables caching and redirects, and never sends the server key", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(billing)));
    vi.stubGlobal("fetch", fetch);
    expect(await modalBillingFor(month, env)).toEqual(billing);
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://worker.test/billing/modal?month=2026-10");
    expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
    const timestamp = options.headers["x-tiny-soho-billing-timestamp"];
    expect(options.headers["x-tiny-soho-billing-signature"]).toBe(createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY)
      .update(`GET\n/billing/modal?month=${month}\n${timestamp}`).digest("hex"));
    expect(JSON.stringify(options)).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("keeps the studio budget usable when billing fails, is malformed or belongs to another cycle", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const response of [
      new Response("offline", { status: 503 }),
      new Response(JSON.stringify({ ...billing, month: "2026-09" })),
      new Response(JSON.stringify({ ...billing, usageUsd: 99 })),
      new Response("invalid JSON"),
    ]) {
      fetch.mockResolvedValueOnce(response);
      expect(await modalBillingFor(month, env)).toEqual({ status: "unavailable", month });
    }
    fetch.mockRejectedValueOnce(new Error("network failure"));
    expect(await modalBillingFor(month, env)).toEqual({ status: "unavailable", month });
  });

  it("does not send credentials to an unconfigured, insecure or credential-bearing URL", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const overrides of [{}, { ...env, CREATIVE_WORKER_BILLING_URL: "http://worker.test" },
      { ...env, CREATIVE_WORKER_BILLING_URL: "https://user:password@worker.test" }]) {
      expect(await modalBillingFor(month, overrides)).toEqual({ status: "unavailable", month });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
