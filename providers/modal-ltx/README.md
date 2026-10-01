# LTX on Modal (`tiny-soho-ltx`)

The default video model: LTX-2.5 22B distilled (bf16) on one RTX PRO 6000, deployed to the `pratikn07` Modal
workspace. The creative worker spawns `Ltx.generate` through Modal's JavaScript SDK
(`creative-worker/src/providers/modal-ltx.ts`) and polls the call id. Ported from `benchmarks/gpu/modal_bench.py`.

## What Modal receives

Only T0's `GenerationInput`: a signed download URL (≤ 300 s) for the **background layer**, a signed upload URL for
`owners/{uid}/projects/{pid}/takes/{takeId}/raw.mp4`, the prompt, seed, size and frame settings. No text layer, no
Supabase key, no other files. URLs contain tokens, so they are never logged or returned.

## Deploy

One-time: the weights are already in the Volume `tiny-soho-models` at `/models/ltx-2.5` (66.2 GiB). Never download
them from a GPU function.

```bash
modal run providers/modal-ltx/app.py::check_image
```

This runs on CPU only: it builds the image and imports the pipeline, so install problems show up before GPU time.

```bash
LTX_ALLOWED_URL_HOSTS=<project-ref>.supabase.co modal deploy providers/modal-ltx/app.py
```

- `LTX_ALLOWED_URL_HOSTS` (optional, read at deploy time): the only hosts the app will download from or upload
  to. Set it to the Supabase storage host.
- `LTX_MAX_CONTAINERS` (default 1, read at deploy time): more containers render in parallel but can multiply spend.

Deploying starts nothing. A GPU container starts on the first `generate` call, loads the model once, and stays up
for 2 minutes after the last call (so a 10-slide carousel loads once). Then it scales to zero.

## Worker configuration

`MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (a Modal service token) go in the worker's environment only. Without
them `modal-ltx` is not registered (`creative-worker/src/providers/index.ts`) and the router reports it as not
configured. Optional: `MODAL_ENVIRONMENT`, and `MODAL_LTX_USD_PER_GPU_SECOND` (default 0.000842). The worker
connects to Modal on the first submit or poll.

## Results and cost

`generate` returns `{ ok, uploaded, gpuSeconds, loadSeconds, peakGib, seed, frames, width, height, gpu }`, or
`{ ok: false, errorCode }` for refusals: `ltx_input_invalid`, `model_unsupported_for_slide`,
`ltx_background_unavailable`, `ltx_upload_failed`, `ltx_out_of_memory`.

The worker computes cost as (`gpuSeconds` + `loadSeconds`) × $0.000842 (RTX PRO 6000, modal.com/pricing
2026-09-29). Idle scale-down time is not attributed to a clip.

A take whose result Modal already has (the Modal Dict `tiny-soho-ltx-takes`, keyed by take id) returns it with
`reused: true` and no new render. The worker also skips spawning when `raw.mp4` already exists.

## After any run

```bash
modal app list
```

`tiny-soho-ltx` stays **deployed** (that is free). Check that it shows **0 tasks** a few minutes after the batch.

```bash
modal container list
```

This should be empty. To remove the app completely: `modal app stop tiny-soho-ltx`.

## Tests

```bash
python -m pytest providers/modal-ltx/tests -q
```

```bash
npm --prefix creative-worker test
```
