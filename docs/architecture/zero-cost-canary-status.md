# Zero-cost canary status

Checked locally on 2026-09-20 (America/Los_Angeles). This record separates
implemented local behavior from owner-controlled provider work; it is not a
claim that any model invocation occurred.

## Canary A: image-only Safe Motion

**Not executed.** The image-only implementation and trusted local FFmpeg
composition path are present, but this checkout has no local `.env`, and both
`DASHSCOPE_API_KEY` and `ALIBABA_WORKSPACE_ID` are unset. No Free Quota Only
confirmation or provider request has been made from this worktree. An owner
must confirm a supported model's free quota in Model Studio and provide the
existing local-only configuration before this canary can be run.

## Canary B: reference-image mode

**Not executed.** Reference images are prepared as bounded Base64 data URLs and
need no remote staging, but share Canary A's provider credential and explicit
Free Quota Only confirmation gate. No model request has been attempted.

## Canary C: local reference video or audio

**Not available under the zero-cost constraint.** The approved temporary
Singapore transport remains `probe-required`: the local `bl` CLI is missing,
and no verified capability record exists. The app therefore rejects a local
URL-required input before job creation unless the owner supplies an existing
safe public URL or an unexpired private provider output. This is an intentional
valid outcome; no storage service, tunnel, or paid infrastructure was created.

## Optional Vision runtime

**Unavailable, correctly reported.** `vision:doctor` found `ffmpeg` and
`ffprobe`, but no FastAPI/Pillow/Uvicorn base runtime, PyTorch, model weights,
or approved remote backend. The repository verification passed without tracked
model or checkpoint artifacts. The implementation does not install packages,
download weights, or acquire GPU infrastructure automatically.

## Knowledge retrieval smoke

**Not executed.** The five-table, reader-only query path is implemented, but
the required reader enablement, connection URL, and trusted CA path are unset
locally. No production database connection was attempted.
