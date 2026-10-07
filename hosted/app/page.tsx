import { StudioEntry } from "@/components/creation/StudioEntry";
import { parseServerEnv } from "@/lib/env";

// Read the server-only release flag per request, including after a configuration rollback.
export const dynamic = "force-dynamic";

export default function Home() {
  const env = parseServerEnv(process.env);
  return <StudioEntry creationsV2Enabled={env.creationsV2Enabled} studioShellEnabled={env.studioShellEnabled} />;
}
