// Scores one reviewer on the four known slides (docs/tasks/P1-ai-slide-review.md). Run from the repo root with the
// reviewer's settings in the environment (the same variables the hosted app reads), for example:
//   REVIEW_PROVIDER=nvidia NVIDIA_API_KEY=... NVIDIA_VISION_MODEL=... npx tsx benchmarks/review/score.mts --runs 3
// Paid reviewers (openai, anthropic) cost money per call: 4 slides x runs calls. Results go to benchmarks/review/results/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { STATIC_CAMERA_SENTENCE, type SlideReview } from "../../hosted/lib/contract";
import { reviewImages } from "../../hosted/lib/review/images";
import { slideReviewRequest } from "../../hosted/lib/review/prompt";
import { reviewerFromEnv } from "../../hosted/lib/review/reviewers";
import { reviewSlide } from "../../hosted/lib/review/run";

type Flag = { label: string; types: string[]; detail: string };
type Slide = {
  id: string;
  background: string;
  text: string | null;
  mustFlag: Flag[];
  mustNotSuggest: Array<{ label: string; pattern: string }>;
  topSafe?: { endStrength: number };
};

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const runs = Number(argument("runs", "3"));
const only = argument("slides", "").split(",").filter(Boolean);
const slides = (JSON.parse(readFileSync("benchmarks/review/slides.json", "utf8")) as Slide[])
  .filter((slide) => !only.length || only.includes(slide.id));

const NEGATIVE = /\b(does not|doesn't|don't|do not|never|without|avoid|not)\b/i;
const flagged = (review: SlideReview, flag: Flag) => review.risks.some((risk) => (
  flag.types.includes(risk.type) || new RegExp(flag.detail, "i").test(risk.detail)
));
const suggests = (review: SlideReview, pattern: string) => review.suggestions.some((suggestion) => (
  new RegExp(pattern, "i").test(`${suggestion.title} ${suggestion.story} ${suggestion.prompt.replace(STATIC_CAMERA_SENTENCE, "")}`)
));

const reviewer = reviewerFromEnv();
const rows: Array<Record<string, unknown>> = [];
console.log(`Reviewer ${reviewer.provider} / ${reviewer.model}, ${runs} runs per slide\n`);

for (const slide of slides) {
  const images = await reviewImages(readFileSync(slide.background), slide.text ? readFileSync(slide.text) : null);
  const request = slideReviewRequest({ images, hasText: slide.text !== null, slideName: slide.id });
  for (let run = 1; run <= runs; run += 1) {
    const started = Date.now();
    try {
      const outcome = await reviewSlide(reviewer, request, { deadline: Date.now() + 120_000 });
      const review = outcome.value;
      const top = review.suggestions[0];
      rows.push({
        slide: slide.id, run, valid: true, attempts: outcome.attempts, seconds: (Date.now() - started) / 1000,
        costUsd: outcome.costUsd,
        flags: Object.fromEntries(slide.mustFlag.map((flag) => [flag.label, flagged(review, flag)])),
        violations: slide.mustNotSuggest.filter((rule) => suggests(review, rule.pattern)).map((rule) => rule.label),
        topSafe: slide.topSafe
          ? top.risk === "safe" && top.end_strength === slide.topSafe.endStrength && top.prompt.endsWith(STATIC_CAMERA_SENTENCE)
            && !NEGATIVE.test(top.prompt.replace(STATIC_CAMERA_SENTENCE, ""))
          : null,
        review,
      });
    } catch (error) {
      rows.push({ slide: slide.id, run, valid: false, error: error instanceof Error ? error.message : "unknown", seconds: (Date.now() - started) / 1000 });
    }
  }
}

console.log("| Slide | Valid JSON | Must flag (hits per run) | Must not suggest (violations) | Top safe suggestion OK | Avg s | Cost |");
console.log("|---|---|---|---|---|---|---|");
for (const slide of slides) {
  const mine = rows.filter((row) => row.slide === slide.id);
  const valid = mine.filter((row) => row.valid);
  const flags = slide.mustFlag.map((flag) => `${flag.label}: ${valid.filter((row) => (row.flags as Record<string, boolean>)[flag.label]).length}/${mine.length}`);
  const violations = slide.mustNotSuggest.map((rule) => `${rule.label}: ${valid.filter((row) => (row.violations as string[]).includes(rule.label)).length}`);
  const topSafe = slide.topSafe ? `${valid.filter((row) => row.topSafe).length}/${mine.length}` : "n/a";
  const seconds = mine.reduce((sum, row) => sum + (row.seconds as number), 0) / Math.max(1, mine.length);
  const cost = valid.reduce((sum: number | null, row) => (sum === null || row.costUsd === null ? null : sum + (row.costUsd as number)), 0);
  console.log(`| ${slide.id} | ${valid.length}/${mine.length} | ${flags.join("; ")} | ${violations.join("; ")} | ${topSafe} | ${seconds.toFixed(1)} | ${cost === null ? "unknown" : `$${cost.toFixed(4)}`} |`);
}

mkdirSync("benchmarks/review/results", { recursive: true });
const file = `benchmarks/review/results/${new Date().toISOString().replace(/[:.]/g, "-")}-${reviewer.provider}.json`;
writeFileSync(file, JSON.stringify({ provider: reviewer.provider, model: reviewer.model, runs, rows }, null, 2));
console.log(`\nFull replies: ${file}`);
