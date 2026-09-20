import { execFile } from "node:child_process";
import { isAllowedProviderResultUrl } from "../assets";
import type { ModelCapability } from "../models";
import type { Asset } from "../store";

type CommandResult = { stdout: string; stderr: string };
export type BailianCommand = (executable: string, args: string[]) => Promise<CommandResult>;

type UploadOptions = {
  asset: Asset;
  model: ModelCapability;
  expiresAfterSeconds: number;
  executable?: string;
  execute?: BailianCommand;
  now?: () => number;
};

function executeBailian(executable: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { shell: false, timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error("Bailian temporary upload failed; no provider locator was retained."));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function isSafeBailianTemporaryLocator(value: string) {
  if (isAllowedProviderResultUrl(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "oss:" && !url.username && !url.password && !url.port && /^[a-z0-9][a-z0-9.-]{1,254}$/i.test(url.hostname) && !url.hostname.includes("..") && url.pathname.length > 1 && !url.pathname.includes("..") && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function urlsIn(value: unknown, remainingDepth = 5): string[] {
  if (!remainingDepth) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => urlsIn(item, remainingDepth - 1));
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((item) => urlsIn(item, remainingDepth - 1));
}

export function temporaryLocatorFromBailianOutput(stdout: string) {
  const candidates: string[] = [];
  try {
    candidates.push(...urlsIn(JSON.parse(stdout)));
  } catch {
    candidates.push(...(stdout.match(/(?:oss|https):\/\/[^\s"'<>]+/g) || []));
  }
  return candidates.find(isSafeBailianTemporaryLocator) || null;
}

export async function uploadBailianTemporaryAsset(options: UploadOptions): Promise<{ url: string; expiresAt: string }> {
  if (!Number.isInteger(options.expiresAfterSeconds) || options.expiresAfterSeconds <= 0) throw new Error("Bailian temporary upload requires a positive verified expiry.");
  const execute = options.execute || executeBailian;
  const executable = options.executable || process.env.TINY_SOHO_BAILIAN_CLI_PATH || "bl";
  const result = await execute(executable, ["file", "upload", "--file", options.asset.path, "--model", options.model.providerModel]);
  const url = temporaryLocatorFromBailianOutput(result.stdout);
  if (!url) throw new Error("Bailian temporary upload did not return an approved provider locator.");
  const now = options.now || Date.now;
  return { url, expiresAt: new Date(now() + options.expiresAfterSeconds * 1000).toISOString() };
}
