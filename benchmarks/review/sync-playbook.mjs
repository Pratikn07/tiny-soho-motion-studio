// Copies docs/strategy/motion-agent-playbook.md into the hosted bundle. Run from the repo root:
//   node benchmarks/review/sync-playbook.mjs
import { readFileSync, writeFileSync } from "node:fs";

const markdown = readFileSync("docs/strategy/motion-agent-playbook.md", "utf8");
writeFileSync(
  "hosted/lib/review/playbook-text.ts",
  "// Generated from docs/strategy/motion-agent-playbook.md by benchmarks/review/sync-playbook.mjs; do not edit.\n"
    + `export const PLAYBOOK_MARKDOWN = ${JSON.stringify(markdown)};\n`,
);
