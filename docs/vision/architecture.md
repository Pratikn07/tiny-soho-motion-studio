# Tiny Soho Vision Track architecture

## Boundaries

The Vision Track is an optional local helper, not a replacement for the
existing generation worker. The browser talks only to the Next.js application.
The application validates local requests and forwards allowed image bytes or
opaque artifact IDs to the Python sidecar at `127.0.0.1:8765`.

```text
Browser / Vision Lab
  -> /api/vision/* (Next.js, loopback request checks)
  -> services/vision (FastAPI, 127.0.0.1 only)
  -> owner-only temporary artifact cache
  -> optional local adapters / FFmpeg
```

The sidecar never receives Alibaba credentials and does not change Supabase,
SQLite, quota accounting, provider payloads, or the production generation
worker. The mock MotionPackage bridge prepares a prompt only; it never creates
or submits a job.

## Capability truthfulness

`lib/capabilities/manifest.json` records product availability, required
runtime, upstream repository and pin, code license, and model/checkpoint
license independently. `GET /v1/capabilities` combines it with a runtime
status. `planned` describes the product capability; it is not evidence that
the local model is installed or usable.

| Capability | Default runtime state | Test backend |
| --- | --- | --- |
| `image.ocr` | unavailable until an explicit, licensed Paddle runtime/checkpoint is configured | deterministic OCR adapter |
| `image.segment` | unavailable until explicit SAM 2 runtime/checkpoint configuration | deterministic PNG-mask adapter |
| `image.layers` | unavailable until reviewed local Qwen model on suitable CUDA | deterministic RGBA-layer adapter |
| `video.compose.typography` | local FFmpeg only | command-contract tests |

No runtime silently substitutes a model or downloads code, checkpoints, or
weights. In particular, PaddleOCR checkpoint licensing remains unresolved:
the package pin is recorded but no checkpoint has been selected or downloaded.

## Local artifacts and privacy

Image uploads are fully decoded with Pillow, limited by bytes and decoded
pixel count, then written only through the `ArtifactManager`. Each file has a
random UUID, metadata, TTL, atomic write, and owner-only cache directory.
Browser paths, filenames, provider URLs, and credentials are not artifact
identifiers. Artifact reads accept only canonical UUIDs.

The default cache is `$TMPDIR/tiny-soho-vision`; set
`TINY_SOHO_VISION_CACHE_DIR` to an owner-controlled directory when project
artifacts must survive temporary-directory cleanup. Artifacts expire according
to `TINY_SOHO_VISION_ARTIFACT_TTL_SECONDS` (24 hours by default). Stop the
sidecar and remove that exact configured cache directory to clean it up; do
not remove a broader temporary or home directory.

## Typography-safe motion pipeline

1. OCR returns every region, including low-confidence text, plus a dilated
   local safety-mask artifact.
2. Segmentation returns binary PNG masks under artifact IDs.
3. The Safe Motion planner consumes normalized OCR/segmentation geometry and
   reduces or rejects risky subject movement using conservative swept bounds.
4. Overlay generation copies original image pixels in protected polygons into
   a full-canvas transparent PNG.
5. A MotionPackage records source and overlay IDs, the safe plan, and explicit
   `avoidTextGeneration`/`preserveComposition` hints.
6. FFmpeg can overlay the trusted PNG above a local MP4 while retaining source
   audio only when it exists. It accepts only owned artifacts and uses argument
   arrays, never a shell command.

The safety mask is guidance for model prompts; local overlay composition is
the mechanism that preserves original typography.

## Optional setup

Base sidecar installation remains intentionally light:

```sh
python3 -m venv .vision-venv
.vision-venv/bin/python -m pip install -r services/vision/requirements.txt
```

The optional files `requirements/ocr.txt`, `requirements/sam2.txt`, and
`requirements/qwen.txt` are not part of base setup or CI. Before using any of
them, review their package licenses, model/checkpoint license, hardware
suitability, source pin, and the exact local model/checkpoint directory. Set
the corresponding `TINY_SOHO_*_ENABLED=1` flag and local path only after that
operator review. A configured package is not proof of a usable model.

## Smoke and verification

`python -m services.vision.integration_smoke` is a no-op by default. Only an
exact `TINY_SOHO_RUN_VISION_INTEGRATION=1` performs a loopback `/health` probe;
it does not invoke model inference. Tests use fake adapters and do not require
PyTorch, PaddleOCR, SAM 2, Qwen, or model weights.
