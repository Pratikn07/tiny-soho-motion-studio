import { StudioError } from "@/lib/errors";

type EnvInput = Record<string, string | undefined>;

export type ServerEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  ownerEmails: string[];
  dashscopeApiKey: string;
  alibabaWorkspaceId: string;
  configured: boolean;
};

const value = (input: EnvInput, key: string) => input[key]?.trim() ?? "";

export function parseServerEnv(input: EnvInput): ServerEnv {
  const supabaseUrl = value(input, "NEXT_PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = value(input, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const supabaseServiceRoleKey = value(input, "SUPABASE_SERVICE_ROLE_KEY");
  const dashscopeApiKey = value(input, "DASHSCOPE_API_KEY");
  const alibabaWorkspaceId = value(input, "ALIBABA_WORKSPACE_ID");
  const ownerEmails = value(input, "TINY_SOHO_STUDIO_ADMIN_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return {
    supabaseUrl,
    supabasePublishableKey,
    supabaseServiceRoleKey,
    ownerEmails,
    dashscopeApiKey,
    alibabaWorkspaceId,
    configured: Boolean(
      supabaseUrl
      && supabasePublishableKey
      && supabaseServiceRoleKey
      && dashscopeApiKey
      && alibabaWorkspaceId
      && ownerEmails.length,
    ),
  };
}

export function requireServerEnv(input: EnvInput = process.env): ServerEnv {
  const serverEnv = parseServerEnv(input);
  if (!serverEnv.configured) {
    throw new StudioError(500, "studio_not_configured", "Studio service configuration is incomplete.");
  }
  return serverEnv;
}
