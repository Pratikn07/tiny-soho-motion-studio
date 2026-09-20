import { parseServerEnv } from "@/lib/env";

export function healthPayload(input: Record<string, string | undefined>) {
  return {
    ok: true,
    configured: parseServerEnv(input).configured,
  };
}
