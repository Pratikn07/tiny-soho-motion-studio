import { describe, expect, it } from "vitest";
import { ownerFromAuthorization } from "@/lib/auth";
import { parseServerEnv } from "@/lib/env";

const user = {
  id: "8db9e0d7-089a-4f7c-a248-9a4d7199c10f",
  email: "owner@tinysoho.test",
};

describe("hosted Studio owner authentication", () => {
  it("accepts an allowlisted Supabase user and normalizes the email", async () => {
    await expect(
      ownerFromAuthorization(
        "Bearer valid",
        async () => ({ data: { user: { ...user, email: "OWNER@TinySoho.Test" } }, error: null }),
        [user.email],
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email });
  });

  it("rejects a request without a bearer token", async () => {
    await expect(
      ownerFromAuthorization(undefined, async () => ({ data: { user }, error: null }), [user.email]),
    ).rejects.toMatchObject({ status: 401, code: "missing_bearer_token" });
  });

  it("rejects an authenticated user outside the owner allowlist", async () => {
    await expect(
      ownerFromAuthorization(
        "Bearer valid",
        async () => ({ data: { user }, error: null }),
        ["other@tinysoho.test"],
      ),
    ).rejects.toMatchObject({ status: 403, code: "not_allowed" });
  });
});

describe("hosted Studio server configuration", () => {
  it("normalizes the owner allowlist and requires only Vercel's own configuration", () => {
    const configuration = parseServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
      TINY_SOHO_STUDIO_ADMIN_EMAILS: " OWNER@TinySoho.Test , second@tinysoho.test ",
    });

    expect(configuration.ownerEmails).toEqual(["owner@tinysoho.test", "second@tinysoho.test"]);
    expect(configuration.configured).toBe(true);
  });
});
