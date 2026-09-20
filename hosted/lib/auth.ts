import { StudioError } from "@/lib/errors";
import { requireServerEnv } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export type UserLookup = (token: string) => Promise<{
  data: { user: { id: string; email?: string } | null };
  error: unknown;
}>;

export async function ownerFromAuthorization(
  header: string | null | undefined,
  getUser: UserLookup,
  allowlist: readonly string[],
) {
  if (!header?.startsWith("Bearer ")) {
    throw new StudioError(401, "missing_bearer_token", "Authentication is required.");
  }

  const token = header.slice(7).trim();
  if (!token) {
    throw new StudioError(401, "empty_bearer_token", "Authentication is required.");
  }

  const { data, error } = await getUser(token);
  if (error || !data.user?.email) {
    throw new StudioError(401, "invalid_token", "Authentication is required.");
  }

  const email = data.user.email.toLowerCase();
  if (!allowlist.map((entry) => entry.toLowerCase()).includes(email)) {
    throw new StudioError(403, "not_allowed", "Studio access is not available for this account.");
  }

  return { userId: data.user.id, email };
}

export async function requireOwner(request: Request) {
  const { ownerEmails } = requireServerEnv();
  const supabase = createServiceSupabaseClient();
  return ownerFromAuthorization(
    request.headers.get("authorization"),
    (token) => supabase.auth.getUser(token),
    ownerEmails,
  );
}
