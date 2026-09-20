import { describe, expect, it } from "vitest";
import { healthPayload } from "@/lib/health";

describe("hosted Studio health route", () => {
  it("reports incomplete configuration without exposing server settings", () => {
    expect(
      healthPayload({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
        TINY_SOHO_STUDIO_ADMIN_EMAILS: "owner@tinysoho.test",
        DASHSCOPE_API_KEY: "",
        ALIBABA_WORKSPACE_ID: "workspace-test",
      }),
    ).toEqual({ ok: true, configured: false });
  });
});
