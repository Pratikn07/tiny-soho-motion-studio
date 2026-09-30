# P1 · AI slide review and creator-idea check

| | |
|---|---|
| Track | Pipeline |
| Agent | Pipeline / AI agent |
| Depends on | T0 |
| Unblocks | U2, B3 (prompt for runs) |
| Owned paths | `hosted/lib/review/**` (new), `hosted/app/api/creations/[id]/slides/[slideId]/review/**`, `.../idea-check/**`, `hosted/app/api/review-runs/**`, `benchmarks/review/**` (comparison harness), tests |
| Branch | `task/p1-ai-review` |

## Why

Each design has its own risks. On the potty slide the girl's hair bun ends at "Start with the basics:"; we only
learned that any lean left makes the text unreadable after 8 GPU clips. A vision model following
[the motion agent playbook](../strategy/motion-agent-playbook.md) can flag that in seconds, suggest three motions,
check the creator's own idea, and write the model prompt using the rules we measured.

## Design

- **Input**: the background layer, the text layer and a flattened preview (background + text), each re-encoded to
  at most 1600 px (as `hosted/app/api/carousel/analyze/route.ts` does today), plus the slide's `UploadCheckResult`.
- **Instructions**: the playbook, sent as the system prompt, plus a short task prompt. The model returns the
  playbook's JSON (`SlideReview`, T0), validated with zod; on invalid JSON retry once, then fail with
  `review_unavailable` (the UI still lets the creator type her own motion).
- **Creator-idea check**: `idea-check` sends the same inputs plus her text; returns
  `{ verdict: "ok" | "adjust", reason, suggestedIdea?, prompt }`. Never silently replaces her idea.
- **Prompts are per model profile**: the review writes the LTX prompt (tested rules). For Wan models (P3) it adds
  a `wan` variant once P3 has prompt notes; until then the same prompt is used and marked uncalibrated.
- **Reviewer choice is decided by measurement.** Candidates: NVIDIA Nemotron (already wired in through
  `hosted/lib/carousel-analysis.ts`, free; about 10 recent fixes for invalid replies) and one API model (Claude or
  GPT through a server-side API key). Build a small harness that runs both on the four known slides and scores:

| Slide | Must flag | Must not suggest |
|---|---|---|
| potty (layered) | hair bun touching "Start with the basics:"; dark hair next to dark text; room to walk left | walking |
| salmon-cakes | food invites a close-up / zoom | camera movement |
| meal-prep | head close to "PART 4" | sitting up / big head movement near the label |
| understanding | head close to the headline column | leaning left |

  Pick the reviewer with more correct flags and valid JSON on 3 of 3 repeated runs. Record cost per review.
- **Storage**: `creative_studio_review_runs` (T0). Synchronous call inside the route (as today's analyze route, 52 s
  timeout) with the row written before and after, so the UI can poll `GET /api/review-runs/:id` if it times out.
- **Privacy**: these are photos of children. Only the owner's account can trigger a review; confirm each provider's
  data terms before enabling it, and record the chosen provider in the review run.

## Implementation plan

1. `hosted/lib/review/playbook.ts`: loads the playbook text (bundled at build time), builds messages.
2. Reviewer adapters: `nvidia.ts` (reuse the request shape from `carousel-analysis.ts`) and `api-model.ts`.
3. zod validation and one retry; map errors to T0 codes.
4. Routes: review, idea-check, review-runs read.
5. `benchmarks/review/`: harness that runs a reviewer on the four slides and prints the score table above (uses
   local files; results git-ignored).
6. Tests with recorded replies (valid, invalid JSON, timeout).

## Gate

- The harness shows the chosen reviewer flags the potty text clash and the salmon zoom risk, and returns valid JSON
  in 3 of 3 runs per slide.
- For the potty slide, the top "safe" suggestion uses end strength 0.6 and a positive-only prompt that ends with the
  static-camera sentence.
- Hosted tests and `check` pass.

## Out of scope

The motion UI (U2), generation (B3, P2).
