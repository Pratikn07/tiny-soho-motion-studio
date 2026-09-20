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
| `image.ocr` | unavailable until an explicit PaddleOCR v5-mobile runtime/checkpoint is provisioned; ready only after a real local inference | deterministic OCR adapter |
| `image.segment` | unavailable until explicit SAM 2 runtime/checkpoint configuration | deterministic PNG-mask adapter |
| `image.layers` | unavailable until reviewed local Qwen model on suitable CUDA | deterministic RGBA-layer adapter |
| `video.compose.typography` | local FFmpeg only | command-contract tests |

No runtime silently substitutes a model or downloads code, checkpoints, or
weights. PaddleOCR uses the explicitly selected `PP-OCRv5_mobile_det` and
`en_PP-OCRv5_mobile_rec` model revisions, both recorded as Apache-2.0 by their
official PaddlePaddle model cards. The base sidecar and CI still exclude the
optional Paddle packages and all checkpoints.

## Local artifacts and privacy

Image uploads are fully decoded with Pillow, limited by a 16 MB default upload
limit and decoded pixel count, then written only through the `ArtifactManager`.
Generated image artifacts have a separate 64 MB default limit. Locally composed
MP4 output has a 1 GB default limit and is adopted from a sidecar-managed
temporary file using atomic rename (or a bounded streaming copy when needed),
never a whole-file Python buffer. Each file has a random UUID, metadata, TTL,
atomic write, and owner-only cache directory.
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
5. A MotionPackage records source and overlay IDs, a generation-plate mode,
   whether text was actually removed, protected-region provenance, the safe
   plan, and explicit `avoidTextGeneration`/`preserveComposition` hints. An
   original flattened slide is explicitly `original-with-protected-text`, never
   described as a clean plate, and receives a conservative motion budget.
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

For PaddleOCR only, an operator can provision the reviewed, pinned v5-mobile
files explicitly. This command prints the exact source revisions and expected
disk use with `--dry-run`; without it, it downloads only those named files into
the chosen owner-controlled directory and writes a local hash manifest. It
refuses any directory in the repository.

```sh
/path/to/vision-venv/bin/python -m pip install -r services/vision/requirements.txt \
  -r services/vision/requirements/ocr.txt
/path/to/vision-venv/bin/python -m services.vision.paddle_provisioning \
  --destination "$HOME/Library/Application Support/Tiny Soho Studio/vision-runtime/models" \
  --profile v5-mobile --dry-run
```

Run the same command without `--dry-run` only after reviewing the stated
license and source revisions. Then configure
`TINY_SOHO_PADDLE_OCR_ENABLED=1`, `TINY_SOHO_PADDLE_OCR_DET_MODEL_DIR`, and
`TINY_SOHO_PADDLE_OCR_REC_MODEL_DIR` to the two provisioned model directories.
The API reports the capability as ready only after the configured runtime loads
and completes a real OCR request; low recognition-confidence text remains in
the typography-safety response.

Activate that same virtual environment before using the operator commands:

```sh
source /path/to/vision-venv/bin/activate
npm run vision:doctor  # configuration and hardware only; no model load
npm run vision:start   # FastAPI on 127.0.0.1 only
npm run vision:smoke   # explicit local OCR on three textual fixtures
```

## Smoke and verification

`python -m services.vision.integration_smoke` is a no-op by default. Only an
exact `TINY_SOHO_RUN_VISION_INTEGRATION=1` performs a loopback `/health` probe;
it does not invoke model inference. Tests use fake adapters and do not require
PyTorch, PaddleOCR, SAM 2, Qwen, or model weights.
