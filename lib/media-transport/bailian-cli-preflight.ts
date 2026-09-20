import { execFile } from "node:child_process";
import type { BailianCommand } from "./bailian";

export type BailianCliPreflight = {
  cliVersion: string;
  uploadHelpAvailable: true;
  authenticated: true;
};

type PreflightOptions = { executable?: string; execute?: BailianCommand };

function executeBailianCli(executable: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(executable, args, { shell: false, timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error("Bailian CLI preflight failed. Verify the official CLI installation and authenticated Singapore profile before retrying."));
      resolve({ stdout, stderr });
    });
  });
}

function safeVersion(stdout: string) {
  return stdout.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][a-z0-9.-]+)?\b/i)?.[0] || "unreported";
}

/** Runs the documented, non-generation CLI checks without retaining CLI output. */
export async function preflightBailianCli(options: PreflightOptions = {}): Promise<BailianCliPreflight> {
  const executable = options.executable || process.env.TINY_SOHO_BAILIAN_CLI_PATH || "bl";
  const execute = options.execute || executeBailianCli;
  try {
    const version = await execute(executable, ["--version"]);
    await execute(executable, ["file", "upload", "--help"]);
    await execute(executable, ["auth", "status"]);
    return { cliVersion: safeVersion(version.stdout), uploadHelpAvailable: true, authenticated: true };
  } catch {
    throw new Error("Bailian CLI preflight failed. Verify the official CLI installation and authenticated Singapore profile before retrying.");
  }
}
