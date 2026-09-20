import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requireServerEnv } from "@/lib/env";

export function createServiceSupabaseClient() {
  const serverEnv = requireServerEnv();
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
