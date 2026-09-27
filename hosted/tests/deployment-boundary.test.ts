import { describe, expect, it } from "vitest";
// @ts-expect-error The production config is intentionally plain JavaScript.
import nextConfig from "../next.config.mjs";

describe("hosted deployment boundary", () => {
  it("emits restrictive browser headers for every hosted route", async () => {
    const headers = await nextConfig.headers?.() as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }> | undefined;
    const policy = headers?.[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value;

    expect(headers?.[0]?.source).toBe("/:path*");
    expect(policy).toContain("connect-src 'self' https://kukpvpklizsvedcmybhn.supabase.co");
    const directives = new Map(policy?.split("; ").map((rule: string) => {
      const [name, ...sources] = rule.split(" "); return [name, sources];
    }));
    expect(directives.get("connect-src")).toContain("blob:");
    expect(directives.get("img-src")).toContain("https://kukpvpklizsvedcmybhn.supabase.co");
    expect(directives.get("media-src")).toContain("https://kukpvpklizsvedcmybhn.supabase.co");
    for (const sources of directives.values()) {
      expect(sources).not.toContain("*");
      expect(sources).not.toContain("https:");
    }
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
