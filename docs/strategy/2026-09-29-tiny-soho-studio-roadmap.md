# Tiny Soho Studio: product and self-hosted video strategy

> **Superseded for implementation (30 September 2026)** by
> [2026-09-30-end-to-end-roadmap.md](2026-09-30-end-to-end-roadmap.md) and the task files in
> [`docs/tasks/`](../tasks/). Since this record: Modal replaced RunPod, LTX was benchmarked, uploads became two
> layers, and the motion rectangle was dropped. Kept as the discussion record.

**Discussion record — 29 September 2026.** This document preserves the direction discussed with the owner. It is a working plan, not a claim that the proposed GPU workflow has been built or proven economical. Recheck provider capabilities, licenses, availability, and prices before buying capacity or implementing a provider.

## What we are building and why

Tiny Soho Studio should let a content creator or marketer turn an existing carousel slide into a short, emotionally meaningful video without redesigning the slide. The immediate use case is Tiny Soho's parenting, toddler-food, and recipe artwork. A creator uploads one or more finished slides, reviews a suggested five-second action for each, generates clips, compares them with the originals, and downloads the result for social publishing. The point is to reuse the considerable work already invested in the carousel: the message, typography, brand, people, food, and composition.

This is a **slide-first creation workspace**, not a general-purpose text-to-video playground. The user should be able to start a new creation as easily as starting a new chat, find previous creations in a sidebar, then work with a visual editor inside each creation. A creation can contain many slides; it should not force a fresh project for each upload. Images can be added in a batch or later, and a nine- or ten-slide carousel must work as one creation. The UI should feel calm, editorial, premium, and visually polished. Examples, a canvas, and later a Cinema Studio or Director are useful only when they serve that core flow. A chat-like conversation for iterative direction may be considered later; the immediate design decision was **sessions in a sidebar plus a visual editor**, not a chat transcript as the main editing surface.

The initial audience is the owner and Tiny Soho content workflow. Broader creator accounts and a commercial multi-user product are possible later, but they require separate tenancy, billing, quotas, abuse controls, and operational work. Do not imply those are already in place.

## Non-negotiable creative behavior

1. **Keep the uploaded composition and aspect ratio.** A source might be 3:4, 4:5, 9:16, or 1:1. Output should retain that same ratio and intended framing. Do not impose one fixed canvas or stretch/crop a source merely to satisfy a model preset. If a model cannot render the required ratio, use a reviewed fitting/composition method or mark the model unsupported for that slide.
2. **Keep all text and brand elements exact and stationary.** The model must not rewrite, misspell, blur, or move titles, recipe copy, labels, logos, or decorations. Protect those pixels or restore an exact source-derived overlay in the final composition. Prompting alone is not an adequate guarantee.
3. **Move only an approved visual area.** When text is on the left and a person is on the right, or text is above a child at the bottom, the person/food should act only within its reserved region. Nothing should wander into the text. The creator must be able to inspect and adjust the suggested movement mask or region before generation.
4. **Tell a small story, not make an idle animation.** Five to seven seconds should have a beginning, action, and emotional payoff at natural speed. Examples: a child choosing a bite, a parent and child exchanging a look, or a change from frustration to understanding. Avoid generic zooms, slow motion, hand-waving, and camera motion that undermines readability.
5. **Treat image analysis as a suggestion.** A vision model can describe people, objects, text, protected areas, and plausible actions. Its result must be visible and editable. It cannot be trusted to identify exact typography or safe motion boundaries without review and validation.

The three supplied Tiny Soho samples represent **different slides, not one carousel**: a text-heavy parenting slide with a child, a meal-prep title slide with a toddler, and a dense recipe/ingredients slide. They are valuable acceptance fixtures because they challenge different parts of the preservation problem. The recipe slide may warrant very limited food motion or no generation if safe movement cannot be established.

## Existing system versus proposed work

The repository contains two related applications. The root app is a Mac-local studio with local media, SQLite, Vision/OCR/segmentation and FFmpeg paths. The hosted app under `hosted/` is the owner-gated web studio on Vercel. Its private project, job, and asset records and media are in Supabase. The hosted generation worker (present on `origin/main` when this was written) downloads an Alibaba result and uploads an MP4 to the private `creative-studio` bucket; users receive authorized access through the app. That existing storage pattern is the right precedent for a new GPU worker.

Earlier work added a more editorial hosted UI, creation sessions, a slide editor, and image-analysis-related capabilities. This document does **not** assert that every one of those flows is production-ready. The local checkout used to write this record is behind `origin/main`, and `hosted/README.md` still describes an earlier MVP boundary. Before implementation, reconcile this document with the then-current main branch, deployed commit, migrations, and live authenticated UI. Keep the root local app and Instagram automation separate from the hosted GPU effort.

The current Alibaba/Wan path is a useful fallback and comparison baseline. NVIDIA vision was explored as an image-understanding option, including model compatibility and API-key setup. Its output should be evaluated for accuracy and cost; it is not a prerequisite for the GPU prototype. A failed or unreadable model call is not evidence that the model understood a slide. Do not send credentials to the browser or confuse a vision model ID with its API key.

## Provider and model strategy

The owner originally preferred Wan because free Alibaba access was available, but the intended workload is much larger than an occasional free-quota experiment. We discussed Wan 3, LTX 2.5, MiniMax H3, and HunyuanVideo 1.5. The present **working hypothesis** is to benchmark a self-hostable, fast/distilled LTX image-to-video configuration on rented GPU capacity first. This is a hypothesis about cost and usability, not a conclusion that LTX is visually best, that Wan 3 cannot be self-hosted, or that any candidate will meet our typography-preservation requirements. “Fast” and “Pro” can be provider product tiers rather than interchangeable local model files; choose a specific published checkpoint and inference recipe only after confirming its license, supported inputs/ratios, hardware requirements, and expected quality.

Compare at least one LTX candidate against a known Wan output on the same representative slides. Include a text-heavy slide, child/parent interaction, food/recipe slide, and each required aspect ratio. Score: text fidelity, boundary violations, source identity, believable action/emotion, output resolution, useful duration, generation time, failure rate, and **full cost per accepted clip**. If the model changes text or cannot respect motion regions, a cheap GPU hour is irrelevant; the composition pipeline or model choice must change. Keep HunyuanVideo and MiniMax as research candidates, not commitments, until their deployment/license and measured economics are clear.

## Expected hosted GPU workflow

```text
Creator uploads slides to Tiny Soho
  → private Supabase source assets and creation/slide records
  → vision/OCR proposes protected text and a motion region
  → creator reviews region and short action/story
  → durable generation job is queued
  → app starts or reuses a rented GPU worker
  → GPU obtains model weights, reads only authorized input, renders a raw clip
  → raw clip is transferred to the application's controlled storage/processing path
  → source-derived protected artwork is composited and final output checked
  → final MP4 and provenance are saved in Tiny Soho's private Supabase storage
  → creator compares, downloads, retries, or approves
  → idle GPU is stopped/terminated under an explicit policy
```

The creator should not need a RunPod account or command line. RunPod provides GPU compute and an API/CLI to manage Pods; **we must develop and operate the inference service** that loads the chosen model, accepts a bounded job, generates video, reports progress/errors, and returns output. We also need a Tiny Soho control path for starting capacity, waiting for readiness, queueing jobs, detecting idle time, and stopping capacity. This is more work than calling a hosted model API, but it exchanges per-video API charges for compute, storage, engineering, and operations costs.

A future “Start GPU” / “Stop GPU” control could make cost visible to the owner, but jobs should not be lost because a page is closed or the switch is clicked. Define whether “Stop” waits for active jobs, cancels them, or refuses until they finish. For a general creator product, capacity management should probably be automated and shown as status rather than exposing infrastructure controls to every user. Use the provider API from a trusted backend, never from the browser. The Pod must authenticate job requests; it should receive short-lived access to only the media needed for that job, not a long-lived Supabase service-role key.

## Storage: what does and does not need to stay on RunPod

**Finished videos do not need durable RunPod storage.** The GPU needs temporary space while loading the model and rendering/encoding a clip. Then the output can be transferred to Tiny Soho's storage, processed, and removed from the Pod. The existing Supabase private bucket is the proposed durable home for input and finished media. The creator may also download outputs to a Mac, but a hosted asynchronous app cannot depend on that Mac being awake or reachable. Supabase storage has its own capacity/transfer costs; it is already part of this application's architecture.

The previously discussed **$14/month** was an *optional 200 GB persistent RunPod network volume for model-weight caching* at an indicative $0.07/GB-month. It was never required for finished videos. Start the benchmark **without** this volume. A fresh Pod must then obtain large model files at startup, potentially consuming paid startup time and bandwidth elsewhere. Measure that cost before deciding whether a persistent cache is worthwhile. RunPod's local Pod volume, network volume, and ephemeral container disk have different stop/termination behavior and prices; do not assume stopping a Pod makes all storage free. Confirm current pricing and GPU/volume compatibility when choosing a region and machine.

## Budget and throughput test

The owner's stated target is **two carousels of ten slides per day**: about 20 clips/day, 600 clips/month, each around five to seven seconds. The preferred spend is at most **$50/month** for this carousel use case. The owner does not want a $200–$250/month API or always-on GPU bill.

At an **illustrative** $0.69/GPU-hour, $50 buys about 72 GPU-hours/month before storage, startup, retries, preprocessing, and any other charges. Across 600 accepted clips that leaves about **7.2 minutes of billable GPU time per accepted clip**, including the allocated share of startup and failures. At $0.99/hour the allowance falls to about **5 minutes**. These are budget arithmetic, not measured LTX speeds or guaranteed RunPod prices. If a daily batch starts a fresh GPU, model download time is amortized over 20 clips; if each clip starts a GPU separately, startup overhead may defeat the budget. Count unsuccessful generations and reruns, not just successful outputs.

Record for each benchmark run: GPU type and price, startup/weight-download time, first generation latency, steady-state latency, VRAM use, actual video duration/resolution, output size, retries, total billable time, storage/transfer costs, and number of clips that meet the creative bar. Calculate cost per *accepted* clip and projected monthly cost at 600 clips. Treat the $50 target as an acceptance gate; if quality or throughput fails, revisit the model, duration/resolution, batching, schedule, or budget rather than silently exceeding it.

## Implementation sequence and decision gates

### 1. Establish a trustworthy baseline

- Bring a clean working branch up to the current `origin/main` without discarding unrelated local work.
- Inspect the deployed hosted app, current creation/slide data model, worker contracts, storage paths, vision and composition paths, and live environment status. Update stale documentation where necessary.
- Freeze a small evaluation set from the owner's example slides, plus representative 4:5, 9:16, and 1:1 cases. Keep originals private; obtain permission and comply with platform rules before using identifiable people or children with a new GPU/model host.
- Define objective checks for ratio, dimensions, unchanged protected text pixels, clip duration, file readability, job ownership, and protected-region intrusion. Pair them with a human rating for story and emotion.

**Gate:** We can reproduce the current hosted flow and compare new output with original artwork and the Alibaba baseline.

### 2. Run a disposable GPU proof of concept

- Verify the exact LTX checkpoint, weights, license, official inference instructions, image-to-video support, aspect-ratio handling, duration, minimum VRAM, and GPU availability.
- Rent a suitable GPU only for a bounded test. Install or containerize the runtime, model dependencies, FFmpeg, and a small authenticated inference endpoint. Use temporary scratch space; no persistent RunPod volume in the first test.
- Render multiple slides in one Pod session. Capture both raw model output and the application's protected/composited result. Stop/terminate the Pod after confirming outputs are safely stored elsewhere.
- Measure cold-start and steady-state time and the full charge; compare quality against the acceptance set.

**Gate:** A chosen candidate meets minimum visual and preservation quality and has a plausible path to 600 accepted clips inside the monthly budget. If not, document the measured gap before further integration.

### 3. Connect a durable generation path

- Specify a provider-neutral job contract: source asset, reviewed motion area, protected overlay/reference, prompt/story, output ratio/resolution/duration, model version, idempotency key, and owning creation/slide.
- Add a server-side RunPod controller and an authenticated GPU worker. Implement readiness checks, bounded concurrency, queue state, retries, timeout/recovery, cancellation behavior, and idle shutdown. Prevent duplicate submits on browser refresh or worker restart.
- Transfer results into the existing private storage architecture using narrowly scoped, expiring authorization. Never place provider tokens or Supabase service credentials in client JavaScript or public logs.
- Compose/restore trusted text and brand layers after generation; verify dimensions and typography; store raw and final provenance as appropriate. Delete temporary GPU artifacts after confirmed transfer.

**Gate:** A browser can submit a slide, leave, return, inspect an accurate job state, and download a verified final video. A failed GPU or upload can be recovered without a surprise duplicate bill.

### 4. Make the editor work for real carousels

- Make multi-image import and append reliable for ten or more slides; show upload/progress/errors per slide. Confirm the earlier “only two at a time” symptom is resolved in the current hosted build, not merely hidden by the UI.
- Show each slide's image, detected text/protected region, editable motion area, suggested five-second story, generation status, original/video/compare views, and export.
- Preserve a creation-session sidebar and automatic saving, with a clear distinction between local draft state, uploaded assets, running jobs, and saved final outputs.
- Keep the aesthetic editorial and premium. Add later Cinema Studio-style camera controls only where they improve reel creation; Canvas, Director, long-form 30-second reel workflows, and assorted open-source features remain separate future projects.

**Gate:** The owner can complete a ten-slide creation without hand-managing projects or infrastructure, and can tell exactly what was saved and where.

### 5. Release safely and observe cost

- Test auth/ownership, multi-slide upload, idempotency, preservation checks, failure recovery, idle shutdown, and cost limits. Run hosted tests/typecheck/build and GPU integration probes appropriate to the change.
- Roll out behind an owner-only feature flag while keeping the working Alibaba path. Deploy every affected component (database migration if needed, Vercel app, worker/controller, GPU image/config), then verify a real authenticated production job and final Supabase asset against the deployed version.
- Track GPU uptime, cold starts, accepted clips, retries, storage consumption, and month-to-date spend. Set a hard budget policy or operational stop mechanism, not just a dashboard warning.

**Gate:** The owner can use the new path in production, verify output quality, and understand the actual cost per accepted carousel.

## Decisions still open

- Which *specific* LTX checkpoint and GPU type win the quality/cost benchmark? No performance claim is accepted without running our slides.
- Can the chosen model handle all source ratios natively, or do we need a reviewed canvas-filling/composition technique for some ratios?
- What minimum output resolution is acceptable for Instagram, and is five seconds adequate for every slide? Longer reels are a later track.
- Should we retain raw GPU output as well as the composited final MP4, and for how long? Decide based on repair value, privacy, and Supabase cost.
- Who can start/stop GPU capacity and what happens to queued/running jobs when it stops?
- Does a persistent model cache pay for itself once cold-start time is measured? The $14 volume remains optional.
- Is NVIDIA vision accurate and economical enough for motion suggestions, or should a different image-analysis method be used? The creator's review remains mandatory either way.
- What customer/tenant, payment, and quota design would be required if this grows beyond the owner's workflow?

## Immediate next action

Do a **small, measured LTX proof of concept** on the supplied Tiny Soho-style slides, with no persistent RunPod storage purchase and no production UI change. Choose the actual checkpoint and GPU only after checking their current requirements. Record quality, cold-start time, steady-state throughput, and projected cost for the 600-clip/month workload. That evidence determines whether to build the production RunPod integration or change course.

## Reference points

- Current repository: root `README.md`, `hosted/README.md`, `docs/superpowers/specs/2026-09-20-hosted-creative-studio-design.md`. These describe different stages of the product and must be checked against current code.
- [RunPod Pod pricing](https://docs.runpod.io/pods/pricing) and [network volumes](https://docs.runpod.io/storage/network-volumes): verify prices and lifecycle behavior at time of use.
- [LTX open-source PyTorch integration](https://docs.ltx.io/open-source-model/integration-tools/pytorch-api): verify the exact published model/inference package before choosing hardware.
