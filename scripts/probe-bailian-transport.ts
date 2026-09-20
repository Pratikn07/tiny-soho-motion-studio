import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadBailianTemporaryAsset } from "../lib/media-transport/bailian";
import { preflightBailianCli } from "../lib/media-transport/bailian-cli-preflight";
import { bailianProbeFixtures, type BailianProbeFixture } from "../lib/media-transport/probe-fixtures";
import { listModels } from "../lib/models";

const confirmation = "I_CONFIRM_THIS_IS_A_NO_GENERATION_UPLOAD_PROBE";

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", args, { shell: false, timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true }, (error) => error ? reject(new Error("Could not create a synthetic no-generation probe fixture.")) : resolve());
  });
}

async function createProbeFixtures(directory: string): Promise<BailianProbeFixture[]> {
  const fixtures = bailianProbeFixtures(directory);
  for (const fixture of fixtures) await runFfmpeg(fixture.command);
  return fixtures;
}

async function main() {
  const providerModel = process.argv[2];
  const expiresAfterSeconds = positiveInteger(process.env.TINY_SOHO_BAILIAN_PROBE_EXPIRY_SECONDS);
  const model = listModels().find((candidate) => candidate.providerModel === providerModel);
  if (process.env.TINY_SOHO_BAILIAN_PROBE_CONFIRM !== confirmation) throw new Error(`Refusing to upload. Set TINY_SOHO_BAILIAN_PROBE_CONFIRM=${confirmation} after confirming the active bl profile is the intended Singapore workspace.`);
  if (!model || !["wan2.7-r2v-2026-06-12", "wan3.0-video"].includes(model.providerModel)) throw new Error("Pass one supported Singapore provider model: wan2.7-r2v-2026-06-12 or wan3.0-video.");
  if (!expiresAfterSeconds) throw new Error("Set TINY_SOHO_BAILIAN_PROBE_EXPIRY_SECONDS to the expiry you have independently confirmed for this exact temporary-upload result.");
  const preflight = await preflightBailianCli();

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tiny-soho-bailian-probe-"));
  try {
    const fixtures = await createProbeFixtures(directory);
    for (const [index, fixture] of fixtures.entries()) {
      const uploaded = await uploadBailianTemporaryAsset({
        asset: { id: `probe-${index}`, projectId: null, kind: "probe", ...fixture.asset, hash: "probe", provenance: "{}", createdAt: new Date().toISOString() },
        model,
        expiresAfterSeconds,
      });
      if (!uploaded.url) throw new Error("Bailian temporary upload did not return a usable locator.");
    }
    const capability = { id: "bailian-temporary-upload", state: "verified", region: "ap-southeast-1", models: [model.providerModel], expiresAfterSeconds, lastVerifiedAt: new Date().toISOString() };
    console.log(`Bailian CLI preflight completed (version ${preflight.cliVersion}); upload help and authenticated profile checks succeeded. The operator-confirmed profile is the intended Singapore workspace.`);
    console.log("Both no-generation video and audio uploads returned approved locators. They are intentionally not printed or saved.");
    console.log("Review this candidate capability record before copying it into your owner-only .env:");
    console.log(JSON.stringify(capability));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Bailian temporary transport probe failed.");
    process.exitCode = 1;
  });
}
