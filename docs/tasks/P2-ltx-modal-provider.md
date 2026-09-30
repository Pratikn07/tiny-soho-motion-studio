# P2 · LTX provider on Modal

| | |
|---|---|
| Track | Pipeline |
| Agent | Pipeline agent |
| Depends on | T0 (provider interface) |
| Unblocks | B3 integration, O1 (GPU seconds per take) |
| Owned paths | `providers/modal-ltx/**` (new: Modal app), `creative-worker/src/providers/modal-ltx.ts` (new), tests |
| Branch | `task/p2-ltx-modal` |

## Why

LTX-2.5 on Modal is the default model. `benchmarks/gpu/modal_bench.py` already runs it: it loads once per
container and renders several slides, with the start frame and an optional pinned end frame. This task turns that
into a deployed service the worker can call, with no Supabase credentials on Modal.

## Design

- **Modal app `tiny-soho-ltx`**, deployed (not `modal run`), in the existing workspace `pratikn07`:
  - Image: the benchmark's `ltx_image` (LTX-2 pinned at `70ee118e0d0541056dc0e69e2e7c4baf9828326d`,
    `uv sync --extra natten` into the image Python; torch 2.13 cu132).
  - Weights from the `tiny-soho-models` Volume (`/models/ltx-2.5`, 66.2 GiB, already downloaded; free under the 1 TiB
    storage allowance).
  - `@app.cls` on `RTX-PRO-6000` so the pipeline object stays loaded between calls in a batch; a short scale-down
    window (about 2 minutes) so a 10-slide carousel loads once, then the GPU is released. Max containers 1 by
    default (budget), configurable.
  - A method `generate(input: GenerationInput)`: downloads the background from `backgroundUrl`, runs
    `DistilledPipeline` with `images=[(bg, 0, 1.0)] + ([(bg, 120, endFrame.strength)] if endFrame)`, encodes MP4,
    uploads it with `PUT outputUploadUrl`, returns `{gpuSeconds, peakGib, seed, frames}`.
  - Settings from the benchmark: 121 frames at 24 fps, generation size from B2 (multiples of 64), audio generated
    but not used.
- **Calling it from the worker** (`creative-worker/src/providers/modal-ltx.ts`, implements `VideoProvider`):
  `submit` spawns the call and stores the Modal call id as `providerTaskId`; `poll` checks the call. Use Modal's
  JavaScript SDK if it supports spawning and polling a deployed function, otherwise a small authenticated web
  endpoint on the Modal app (`POST /submit`, `GET /status/:id`) protected with a Modal proxy token. Decide in the PR
  and record why.
- **Security**: Modal receives only a 300 s signed download URL for the background and a signed upload URL for
  `owners/{uid}/projects/{pid}/takes/{takeId}/raw.mp4`. No service-role key, no text layer, no other files.
  `MODAL_TOKEN_ID/SECRET` (or the proxy token) live only in the worker's environment.
- **Idempotency**: the output path is fixed per take; if `raw.mp4` already exists, `submit` returns success without
  a new GPU call. A re-spawn after a worker crash therefore costs nothing extra.
- **Cost**: returns `gpuSeconds`; cost = GPU seconds × catalog price ($0.000842/s for RTX PRO 6000, 2026-09-29).

## Implementation plan

1. Move the benchmark's image and pipeline code into `providers/modal-ltx/app.py` (class with `@modal.enter` to
   build the pipeline once, `generate` method). Keep the benchmark as-is for experiments.
2. Add the input/upload handling and return metadata.
3. Worker provider adapter + registry entry for `modal-ltx` (B5).
4. Tests: adapter unit tests with a fake Modal client; one manual staging run documented in the PR (2 slides, 2
   seeds, timings, cost).
5. Deployment notes in `providers/modal-ltx/README.md` (`modal deploy`, secrets, how to check nothing is running).

## Gate

- From staging, a take for the potty background with end strength 0.6 produces `raw.mp4` in the bucket; worker
  records GPU seconds (~35–60 s) and cost.
- A second submit for the same take does not start a GPU call.
- `modal app list` shows no running containers a few minutes after the batch.
- 9:16 and 1:1 backgrounds generate at their B2 sizes without errors.

## Out of scope

Finishing and checks (P4, P5), the Alibaba provider (P3), retries (B3).
