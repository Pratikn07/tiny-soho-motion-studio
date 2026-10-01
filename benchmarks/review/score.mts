// Scores one reviewer on the four known slides (docs/tasks/P1-ai-slide-review.md). Run from the repo root with the
// reviewer's settings in the environment (the same variables the hosted app reads), for example:
//   REVIEW_PROVIDER=nvidia NVIDIA_API_KEY=... NVIDIA_VISION_MODEL=... npx tsx benchmarks/review/score.mts --runs 3
// Paid reviewers (openai, anthropic) cost money per call: 4 slides x runs calls. Results go to benchmarks/review/results/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { STATIC_CAMERA_SENTENCE, type SlideReview } from "../../hosted/lib/contract";
import { reviewImages } from "../../hosted/lib/review/images";
import { slideReviewRequest } from "../../hosted/lib/review/prompt";
import { reviewerFromEnv, type Reviewer } from "../../hosted/lib/review/reviewers";
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

const maxUsd = Number(argument("max-usd", "Infinity"));
const baseReviewer = reviewerFromEnv();
const paid = baseReviewer.provider !== "nvidia";
if (paid && Number.isFinite(maxUsd)
  && !(Number(process.env.REVIEW_USD_PER_MILLION_INPUT_TOKENS) && Number(process.env.REVIEW_USD_PER_MILLION_OUTPUT_TOKENS))) {
  throw new Error("Set REVIEW_USD_PER_MILLION_INPUT_TOKENS and REVIEW_USD_PER_MILLION_OUTPUT_TOKENS so --max-usd can be enforced.");
}

/** Every reviewer call is counted; a call that could take spend past --max-usd is not made. */
const spend = { usd: 0, calls: 0, largestCall: 0.1, stopped: false };
const reviewer: Reviewer = {
  ...baseReviewer,
  async complete(request, signal) {
    if (spend.usd + spend.largestCall > maxUsd) {
      spend.stopped = true;
      throw new Error("spend_cap_reached");
    }
    const reply = await baseReviewer.complete(request, signal);
    spend.calls += 1;
    if (reply.costUsd === null && paid) throw new Error("cost_unknown");
    spend.usd += reply.costUsd ?? 0;
    spend.largestCall = Math.max(spend.largestCall, reply.costUsd ?? 0);
    return reply;
  },
};

/** Results never keep image data: data URLs or long base64 runs are replaced before saving. */
const IMAGE_DATA = /data:image\/|[A-Za-z0-9+/=]{200,}/;
const withoutImageData = (value: unknown): unknown => {
  if (typeof value === "string") return IMAGE_DATA.test(value) ? "[removed: image data]" : value;
  if (Array.isArray(value)) return value.map(withoutImageData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutImageData(item)]));
  return value;
};

const rows: Array<Record<string, unknown>> = [];
console.log(`Reviewer ${reviewer.provider} / ${reviewer.model}, ${runs} runs per slide${Number.isFinite(maxUsd) ? `, spend cap $${maxUsd}` : ""}\n`);

for (const slide of slides) {
  if (spend.stopped) break;
  const images = await reviewImages(readFileSync(slide.background), slide.text ? readFileSync(slide.text) : null);
  const request = slideReviewRequest({ images, hasText: slide.text !== null, slideName: slide.id });
  for (let run = 1; run <= runs && !spend.stopped; run += 1) {
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
writeFileSync(file, JSON.stringify(withoutImageData({ provider: reviewer.provider, model: reviewer.model, runs, spend, rows }), null, 2));

const attempted = rows.length;
const validRuns = rows.filter((row) => row.valid).length;
const hits = (slideId: string, labelPart: string) => {
  const mine = rows.filter((row) => row.slide === slideId);
  const found = mine.filter((row) => row.valid && Object.entries(row.flags as Record<string, boolean>)
    .some(([label, hit]) => hit && label.includes(labelPart))).length;
  return `${found}/${mine.length}`;
};
console.log(`\nValid JSON: ${validRuns}/${attempted} runs (${attempted ? Math.round((validRuns / attempted) * 100) : 0}%)`);
console.log(`Subject close to text: potty ${hits("potty", "hair bun")}, meal-prep ${hits("meal-prep", "PART 4")}, understanding ${hits("understanding", "headline")}`);
console.log(`Room to walk toward the text (potty): ${hits("potty", "walk")}`);
console.log(`Salmon zoom or close-up risk: ${hits("salmon-cakes", "close-up")}`);
console.log(`Spend: $${spend.usd.toFixed(4)} over ${spend.calls} replies${spend.stopped ? " (stopped at the spend cap)" : ""}`);
console.log(`Replies (no image data): ${file}`);
