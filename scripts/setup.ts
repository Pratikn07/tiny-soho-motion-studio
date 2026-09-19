import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { dataDir } from "../lib/config";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const exists = (command: string) => { try { execFileSync("which", [command], { stdio: "ignore" }); return true; } catch { return false; } };
const valueFor = (text: string, key: string) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() || "";
const upsert = (text: string, key: string, value: string) => {
  const line = `${key}=${value.trim().replace(/[\r\n]/g, "")}`;
  return new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
};
async function hiddenQuestion(prompt: string) {
  if (!process.stdin.isTTY) return rl.question(prompt);
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise<string>((resolve) => { let value = ""; const onData = (chunk: Buffer) => { const char = chunk.toString("utf8"); if (char === "\r" || char === "\n") { process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdout.write("\n"); resolve(value); } else if (char === "\u0003") process.exit(130); else if (char === "\u007f") value = value.slice(0, -1); else value += char; }; process.stdin.on("data", onData); });
}
async function main() {
  console.log(`Node ${process.versions.node} · ffmpeg ${exists("ffmpeg") ? "ready" : "missing"} · ffprobe ${exists("ffprobe") ? "ready" : "missing"}`);
  fs.mkdirSync(dataDir(), { recursive: true });
  const envPath = path.join(process.cwd(), ".env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "PORT=3001\n";
  if (!valueFor(env, "ALIBABA_WORKSPACE_ID")) env = upsert(env, "ALIBABA_WORKSPACE_ID", await rl.question("Alibaba Singapore workspace ID: "));
  if (!valueFor(env, "DASHSCOPE_API_KEY")) env = upsert(env, "DASHSCOPE_API_KEY", await hiddenQuestion("DashScope API key (hidden): "));
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  console.log("Saved .env with owner-only permissions. In Alibaba Model Studio, enable Free Quota Only for each model before confirming it in Settings.");
  await rl.close();
}
void main();
