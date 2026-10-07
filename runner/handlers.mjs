// What the runner does for each reel step. Thinking steps call Claude Code on this Mac (`claude -p`, your login);
// mechanical steps will run plain scripts. Steps not built yet fail clearly instead of guessing.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stepError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Runs one Claude Code turn with no tools and returns its text answer. */
export function askClaude(prompt, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), "tiny-soho-runner-"));
    const child = spawn("claude", ["-p", prompt, "--output-format", "json", "--max-turns", "1", "--allowedTools", ""], { cwd });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(stepError("claude_timeout", "Claude Code took too long.")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(stepError("claude_unavailable", `Could not start Claude Code: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(stepError("claude_failed", (err || out).trim().slice(0, 200) || `claude exited with ${code}`));
      try { resolve(JSON.parse(out).result ?? ""); } catch { resolve(out); }
    });
  });
}

function firstJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw stepError("claude_bad_output", "Claude did not return a list.");
  return JSON.parse(match[0]);
}

/** House rules for every Tiny Soho script, from the first reel ("It's Not the Sugar"). */
const SCRIPT_RULES = [
  "Tiny Soho is a calm, realistic parenting account for US moms of toddlers. Voice: a warm mom narrator.",
  "Length: 20-30 seconds spoken, about 55-75 words, 6-9 lines. US spelling.",
  "Line 1 is the hook: a clear, surprising claim a viewer understands in the first 2 seconds.",
  "Shape: conflict, then one big question, then the twist, then one easy thing to do.",
  "Every line gets one matching visual (onScreen), short enough to read on a phone.",
  "Voice cues in square brackets are allowed at the start of a line: [curious] [pause] [warmly] [softly] [whispers] [slowly] [excited].",
  "No shaming of kids, parents or food. No medical advice. Only widely established facts; hedge anything uncertain with 'probably'.",
  "End with a save prompt tied to a future moment (for example 'Save this for Halloween night').",
].join("\n");

const scriptAnswer = 'Answer with only JSON: {"lines": [{"time": "0:00", "voice": string, "onScreen": string}], "notes": string}. '
  + "Times are estimates in m:ss. notes: one sentence on any fact a person should double-check.";

function parseScript(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw stepError("claude_bad_output", "Claude did not return a script.");
  const data = JSON.parse(match[0]);
  const lines = (Array.isArray(data.lines) ? data.lines : []).slice(0, 20).map((line) => ({
    time: String(line.time ?? "").slice(0, 12), voice: String(line.voice ?? "").slice(0, 400), onScreen: String(line.onScreen ?? "").slice(0, 200),
  })).filter((line) => line.voice);
  if (!lines.length) throw stepError("claude_bad_output", "The script came back empty.");
  return { lines, notes: String(data.notes ?? "").slice(0, 500) };
}

const handlers = {
  /** Idea, first draft: three story ideas for the topic, for the creator to pick from. */
  "idea/draft": async (job, reel, { progress }) => {
    await progress("Asking Claude for three story ideas");
    const topic = String(job.input.topic ?? reel?.title ?? "").slice(0, 400);
    const text = await askClaude([
      "You write story ideas for @tinysoho, a calm, realistic parenting account (mostly US moms of toddlers).",
      "Give three ideas for a 20-30 second motion-graphics story reel. No recipes, no shaming, no medical advice.",
      `Topic: ${topic || "anything timely for parents of toddlers"}`,
      'Answer with only a JSON array of 3 objects: {"title": string, "hook": string, "why": string}.',
    ].join("\n"));
    const ideas = firstJsonArray(text).slice(0, 3).map((idea) => ({
      title: String(idea.title ?? "").slice(0, 120), hook: String(idea.hook ?? "").slice(0, 200), why: String(idea.why ?? "").slice(0, 300),
    }));
    return { status: "needs_review", result: { ideas }, progress: "Three ideas ready for review" };
  },
};

handlers["script/draft"] = async (job, reel, { progress }) => {
  await progress("Claude is writing the script");
  const idea = job.input.idea ?? {};
  const text = await askClaude([SCRIPT_RULES, "", `Idea: ${idea.title ?? ""}`, `Hook: ${idea.hook ?? ""}`, `Why it works: ${idea.why ?? ""}`,
    `Original topic: ${String(job.input.topic ?? "").slice(0, 400)}`, "", "Write the reel script.", scriptAnswer].join("\n"));
  return { status: "needs_review", result: parseScript(text), progress: "Script ready for review" };
};

handlers["script/revise"] = async (job, reel, { progress }) => {
  await progress("Claude is changing the script");
  const text = await askClaude([SCRIPT_RULES, "", `Idea: ${job.input.idea?.title ?? ""}`, "Current script (JSON):",
    JSON.stringify(job.input.lines ?? []), "", `The creator asks: ${String(job.input.comments ?? "").slice(0, 1000)}`,
    "Change only what they ask; keep everything else.", scriptAnswer].join("\n"));
  return { status: "needs_review", result: parseScript(text), progress: "Revised script ready for review" };
};

export async function handle(job, reel, tools) {
  const handler = handlers[`${job.step}/${job.kind}`];
  if (!handler) throw stepError("step_not_ready", `The ${job.step} step (${job.kind}) isn't built into the runner yet.`);
  return handler(job, reel, tools);
}
