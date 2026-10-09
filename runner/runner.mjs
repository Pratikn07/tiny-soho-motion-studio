#!/usr/bin/env node
// Tiny Soho Studio Mac runner. Checks in with the Studio every 20 s, claims reel jobs, runs them on this Mac and
// reports back. Claude Code runs only for the thinking steps (handlers.mjs); renders and mixes are plain scripts.
// Config: ~/.config/tiny-soho/runner.env (see runner.env.example). No dependencies: Node 22+.
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { handle } from "./handlers.mjs";

const VERSION = "0.5.0";
const HEARTBEAT_MS = 20_000;
const IDLE_POLL_MS = 10_000;
const RENEW_MS = 45_000;

function loadConfig() {
  const file = process.env.TINY_SOHO_RUNNER_ENV ?? join(homedir(), ".config", "tiny-soho", "runner.env");
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  const config = {
    url: (values.TINY_SOHO_STUDIO_URL ?? "").replace(/\/$/, ""),
    token: values.TINY_SOHO_RUNNER_TOKEN ?? "",
    runnerId: values.TINY_SOHO_RUNNER_ID ?? "studio-mac",
    label: values.TINY_SOHO_RUNNER_LABEL ?? `Studio Mac (${hostname()})`,
    claudeAuth: values.TINY_SOHO_CLAUDE_AUTH === "api_key" ? "api_key" : "subscription",
    // The Voice step: the owner's ElevenLabs key and cloned voice. Never logged.
    elevenlabs: { key: values.ELEVENLABS_API_KEY ?? "", voiceId: values.ELEVENLABS_VOICE_ID ?? "" },
    arenaBoards: values.TINY_SOHO_ARENA_BOARDS === "off" ? "off" : "on",
    // The Build step's copy of the motion engine (a git worktree on branch `studio`); empty means the default path.
    engineDir: values.TINY_SOHO_ENGINE_DIR ?? "",
  };
  if (!config.url || config.token.length < 32) throw new Error(`Set TINY_SOHO_STUDIO_URL and TINY_SOHO_RUNNER_TOKEN in ${file}`);
  return config;
}

const config = loadConfig();
const log = (...parts) => console.log(new Date().toISOString(), ...parts);

async function call(path, method, body) {
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${data?.error?.code ?? ""}`);
  return data;
}

const heartbeat = () => call("/api/runner/heartbeat", "POST", {
  runnerId: config.runnerId, label: config.label, claudeAuth: config.claudeAuth, version: VERSION,
}).catch((error) => log("heartbeat failed:", error.message));

async function runJob({ job, reel }) {
  log(`claimed ${job.step}/${job.kind} job ${job.id} for "${reel?.title ?? job.reelId}"`);
  const update = (patch) => call(`/api/runner/jobs/${job.id}`, "PATCH", { leaseId: job.leaseId, ...patch });
  const renew = setInterval(() => update({ status: "running" }).catch((error) => log("lease renewal failed:", error.message)), RENEW_MS);
  try {
    // Files a job makes (voice takes) go to the reel's storage folder through a one-time link from the Studio.
    const upload = async (name, mime, bytes) => {
      const link = await call(`/api/runner/jobs/${job.id}/files`, "POST", { leaseId: job.leaseId, name, mime });
      const put = await fetch(link.uploadUrl, { method: "PUT", headers: { "content-type": mime, "x-upsert": "false" }, body: bytes });
      if (!put.ok) throw Object.assign(new Error(`Uploading ${name} failed (${put.status}).`), { code: "upload_failed" });
      return link.objectPath;
    };
    const outcome = await handle(job, reel, {
      progress: (text) => update({ status: "running", progress: text.slice(0, 200) }), upload, env: { ...config.elevenlabs, engineDir: config.engineDir, arenaBoards: config.arenaBoards },
    });
    await update({ status: outcome.status, result: outcome.result, progress: outcome.progress ?? "Done" });
    log(`job ${job.id} -> ${outcome.status}`);
  } catch (error) {
    log(`job ${job.id} failed:`, error.message);
    await update({ status: "failed", errorCode: (error.code ?? "runner_error").slice(0, 120), progress: error.message.slice(0, 200) })
      .catch((reportError) => log("could not report failure:", reportError.message));
  } finally {
    clearInterval(renew);
  }
}

async function main() {
  log(`runner ${config.runnerId} ${VERSION} -> ${config.url} (Claude: ${config.claudeAuth})`);
  await heartbeat();
  setInterval(heartbeat, HEARTBEAT_MS);
  for (;;) {
    try {
      const claimed = await call("/api/runner/claim", "POST", { runnerId: config.runnerId });
      if (claimed) { await runJob(claimed); continue; }
    } catch (error) {
      log("claim failed:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
}

main();
