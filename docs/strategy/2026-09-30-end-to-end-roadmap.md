# Tiny Soho Studio: end-to-end roadmap

**30 September 2026.** Replaces the implementation parts of
[2026-09-29-tiny-soho-studio-roadmap.md](2026-09-29-tiny-soho-studio-roadmap.md), which stays as the discussion
record. Built on `main` at `2844033` and on the LTX benchmark in `benchmarks/gpu/` (29–30 September).

## Goal

The creator (the owner's wife) uploads a carousel of finished slides. For each slide, only the child or the food
comes alive for about 5 seconds, while her text and brand elements stay exactly as designed and can animate in
line by line. She picks a motion from AI suggestions or writes her own, chooses a model if she wants, and downloads
publishable clips. Target: 2 carousels × 10 slides a day (~600 clips a month) for at most $50 a month.

## How a slide becomes a video

```text
Upload two layers per slide ─► upload checks ─► AI review (risks + 3 motion suggestions)
   background (no text)          sizes, alpha,        playbook: docs/strategy/motion-agent-playbook.md
   text layer (transparent)      aspect ratio
                                                            │ creator picks / edits motion, picks model
                                                            ▼
                       Router ──► LTX 2.5 on Modal (default)  ─┐
                              └─► Alibaba Wan (selectable)    ─┤ raw clip of the background only
                                                               ▼
                       Finishing: colour match + text lines fade and rise in (her exact pixels)
                                                               ▼
                       Checks: camera still · nothing behind letters · clean loop ──fail──► retry new seed
                                                               ▼
                       Takes shown side by side ─► creator chooses ─► download
```

The model never sees the text. Everything after the model is the same for every provider, so providers are
interchangeable and compared on the same checks.

## Decisions already made (with evidence)

| Decision | Why |
|---|---|
| **Modal** for GPU, not RunPod | Scales to zero, per-second billing, no start/stop controller to build. 0 apps running after every test |
| **LTX-2.5 22B distilled (bf16)**, RTX PRO 6000, 768×960, 121 frames at 24 fps | ~36 s GPU per clip steady-state, ~$0.03 per clip; ~$18/month for 600 clips before retries. Peak 42.5 GiB, so not a 32 GB 5090 at bf16 |
| **Layered uploads** (background + transparent text layer) are the primary input | No text detection or erasing; LTX animates a clean picture; text stays her exact pixels |
| **Text-only protection** replaces the motion rectangle | The single rectangle cut hair and froze wall (seams in 4 of 4 meal-prep clips). Text boxes only: text drift 1.4–2.4, same as an untouched still |
| **Pin the last frame** to the same background, strength 0.6 by default | Without it the child walked into the text in 4 of 4 potty clips; with it 2 of 2 stayed put and looped (first-vs-last 2.3–2.6) |
| **Positive-only prompts** with an explicit end state and the static-camera sentence | "Don't walk left" was ignored 2 of 2; camera zooms fell from 1 in 3 to 1 in 12 with the camera sentence |
| **Automatic checks + retry** | `camera_drift` < ~12, `behind_text` < 9% of any line's letters, loop < ~5. Calibrated on few clips; recheck with more slides |
| **AI review before GPU time**, following the playbook | The potty text clash was only found after 8 clips; a review would flag it in seconds |
| **Provider router + model selector**: LTX default, Alibaba Wan selectable | Keeps the working Alibaba path; Wan costs ~14× more per clip, so the cost is shown before generating |
| **No app sample data** (old motion areas, protected boxes, stories) is reused | They were built for the rectangle/Wan flow and caused the seams |

## Tracks and task index

Each task has its own file in [`docs/tasks/`](../tasks/) with a design, an implementation plan and a gate.

| ID | Track | Task | Depends on | Wave |
|---|---|---|---|---|
| [T0](../tasks/T0-contract.md) | Contract | Data model, API shapes, states, provider interface | — | 0 |
| [B1](../tasks/B1-layered-upload.md) | Backend | Layered slide upload and storage | T0 | 1 |
| [B2](../tasks/B2-upload-checks.md) | Backend | Upload checks (size, transparency, haze, ratio) | B1 | 2 |
| [B3](../tasks/B3-pipeline-orchestration.md) | Backend | Server-side pipeline runs (no browser needed) | T0; integrates B5, P2–P5 | 3 |
| [B4](../tasks/B4-worker-hardening.md) | Backend | Fix existing worker bugs and idempotency gaps | T0 | 1 |
| [B5](../tasks/B5-catalog-and-router.md) | Backend | Model catalog, provider router, billing acknowledgement | T0 | 1 |
| [P1](../tasks/P1-ai-slide-review.md) | Pipeline | AI slide review and creator-idea check | T0 | 1 |
| [P2](../tasks/P2-ltx-modal-provider.md) | Pipeline | LTX provider on Modal | T0 | 1 |
| [P3](../tasks/P3-alibaba-provider.md) | Pipeline | Alibaba Wan behind the router | B5 | 2 |
| [P4](../tasks/P4-finishing.md) | Pipeline | Finishing: colour match and text-line animation | T0 | 1 |
| [P5](../tasks/P5-checks-and-retry.md) | Pipeline | Automatic checks and retry policy | P4 | 2 |
| [U1](../tasks/U1-creation-and-upload-ui.md) | UI | Creation page and layered upload | T0 (mocks), B1 | 1 |
| [U2](../tasks/U2-motion-and-model-ui.md) | UI | Motion suggestions, creator idea, model selector | T0 (mocks), P1, B5 | 2 |
| [U3](../tasks/U3-takes-and-results-ui.md) | UI | Progress, takes side by side, choose, download | T0 (mocks), B3 | 3 |
| [U4](../tasks/U4-text-animation-ui.md) | UI | Text animation options and preview | T0 (mocks), P4 | 2 |
| [O1](../tasks/O1-cost-and-budget.md) | Ops | Spend ledger, monthly cap, cost per accepted clip | B5, B3 | 3 |
| [O2](../tasks/O2-release.md) | Ops | Feature flag, deploy, docs, production verification | all | 4 |

**Waves.** Wave 0 must merge before anyone else starts. Tasks in the same wave can run in parallel on separate
agents. A UI task can start as soon as T0 is merged, against mock data that follows the contract; it only needs
its backend dependency for the integration step at the end.

## Rules for parallel agents

1. **The contract is the source of truth.** T0 defines types, tables, endpoints and states. If a task needs a
   change, it proposes an amendment to `docs/tasks/T0-contract.md` in its PR; it does not invent a shape.
2. **One branch per task:** `task/<id>-<slug>` (for example `task/p2-ltx-modal`), ideally in its own worktree.
3. **Owned paths.** Each task file lists the paths it may change. Touching another task's paths needs a note in
   the PR and a check with that task's owner.
4. **Shared files get one-line registrations only.** `hosted/lib/repository.ts`, `creative-worker/src/index.ts`,
   `creative-worker/src/providers/index.ts`, `creative-vision/src/processor.py` and
   `creative-vision/src/repository.py` are touched by several tasks. Put new code in the task's own module
   (for example `hosted/lib/repo/<task>.ts`, `creative-vision/src/finish.py`) and add only the import and
   registration line to the shared file, so merges stay trivial.
5. **Each task is testable alone**: unit tests with fixtures or mocks, no dependency on another unmerged branch.
6. **Gate before merge**: the task's gate section is the definition of done, with evidence in the PR (test output,
   screenshots, sample clips kept out of git).
7. **No credentials in code, logs or chat.** Server-side only. Modal and Alibaba keys never reach the browser.
8. **Children's images stay private**: the `creative-studio` bucket only, short-lived signed URLs, results folders
   git-ignored.

## Release gate (whole project)

The creator completes a 10-slide layered carousel in production without help: uploads, reviews suggestions,
generates, sees takes with check results, chooses and downloads. At least 8 of 10 slides have an accepted take
within 2 retries. Text on every final is pixel-exact to her layer. Month-to-date spend is visible and a hard cap
stops generation before $50.

## Open questions

| Question | Owner task |
|---|---|
| Which review model: NVIDIA Nemotron (free, wired in) or an API model (Claude / GPT)? Decide by scoring both on the 4 known slides | P1 |
| Does Alibaba's image-to-video API accept a last frame? Without it, Wan clips may wander into the text | P3 |
| Support flat (non-layered) uploads too? Would need server-side text detection (Tesseract on Linux) and text-only protection | B1 / P4 (later) |
| 9:16 and 1:1 slides are untested; LTX sizes must be multiples of 64 | P2 |
| Children's photos sent to third-party APIs (NVIDIA, Alibaba, an AI review API): confirm consent and each provider's data terms | P1, P3 |
| LTX licence: free under $10M revenue; outputs must be labelled as AI-generated (Instagram AI label). Competitor clause matters only if opened to other creators | O2 |
| Modal's $30/month credit is not guaranteed; the budget must hold without it (~$18 + retries) | O1 |
| 7-second clips (the current app and benchmark are 5 s) | later |

## Known issues found on `main` (fixed in B4 unless noted)

- `creative_studio_job_events.event_type` does not allow `'running'`, but the worker inserts `event_type = status`
  (`creative-worker/src/worker.ts:152`), so every "running" update throws after the job row is written.
- Alibaba submit has no provider-side idempotency key; a crash between submit and the `submitted` update can
  create a duplicate billable task.
- Ingest writes a new UUID path on every attempt (orphaned MP4s on retry).
- Generation and composition are driven by the browser's polling loop; closing the page stops the pipeline (B3).
- The model is hard-coded as `wan2.7-i2v` in `hosted/app/api/carousel/[id]/generate/route.ts:40` and
  `hosted/components/carousel/useCarouselWorkspace.ts:97` (B5).
- `PRODUCT.md` and `hosted/README.md` describe an earlier stage (O2).

## Reference implementation

`benchmarks/gpu/` is working code for the pipeline tasks: `modal_bench.py` (LTX on Modal, start and end frames,
seeds), `animate_text.py` (line splitting, text animation, behind-text check), `compose.py` (colour match,
text-only protection, camera check), `find_text.swift` (Apple Vision text detection) and `layered.json`. Port its
logic; do not import it from production code.
