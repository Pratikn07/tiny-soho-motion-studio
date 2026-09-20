import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uploadBailianTemporaryAsset } from "../lib/media-transport/bailian";
import { listModels } from "../lib/models";

const confirmation = "I_CONFIRM_THIS_IS_A_NO_GENERATION_UPLOAD_PROBE";
const fixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLFWQAAAABJRU5ErkJggg==", "base64");

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function main() {
  const providerModel = process.argv[2];
  const expiresAfterSeconds = positiveInteger(process.env.TINY_SOHO_BAILIAN_PROBE_EXPIRY_SECONDS);
  const model = listModels().find((candidate) => candidate.providerModel === providerModel);
  if (process.env.TINY_SOHO_BAILIAN_PROBE_CONFIRM !== confirmation) throw new Error(`Refusing to upload. Set TINY_SOHO_BAILIAN_PROBE_CONFIRM=${confirmation} after confirming the active bl profile is the intended Singapore workspace.`);
  if (!model || !["wan2.7-r2v-2026-06-12", "wan3.0-video"].includes(model.providerModel)) throw new Error("Pass one supported Singapore provider model: wan2.7-r2v-2026-06-12 or wan3.0-video.");
  if (!expiresAfterSeconds) throw new Error("Set TINY_SOHO_BAILIAN_PROBE_EXPIRY_SECONDS to the expiry you have independently confirmed for this exact temporary-upload result.");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tiny-soho-bailian-probe-"));
  const filePath = path.join(directory, "probe.png");
  try {
    await fs.writeFile(filePath, fixture, { mode: 0o600 });
    const uploaded = await uploadBailianTemporaryAsset({
      asset: { id: "probe", projectId: null, kind: "probe", name: "probe.png", mime: "image/png", path: filePath, width: 1, height: 1, duration: null, hash: "probe", provenance: "{}", createdAt: new Date().toISOString() },
      model,
      expiresAfterSeconds,
    });
    const capability = { id: "bailian-temporary-upload", state: "verified", region: "ap-southeast-1", models: [model.providerModel], expiresAfterSeconds, lastVerifiedAt: new Date().toISOString() };
    if (!uploaded.url) throw new Error("Bailian temporary upload did not return a usable locator.");
    console.log("No-generation upload probe returned an approved locator. It is intentionally not printed or saved.");
    console.log("Review this candidate capability record before copying it into your owner-only .env:");
    console.log(JSON.stringify(capability));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Bailian temporary transport probe failed.");
  process.exitCode = 1;
});
