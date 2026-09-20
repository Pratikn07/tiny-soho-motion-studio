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
| `image.segment` | unavailable until explicit SAM 2.1 tiny runtime/checkpoint configuration; ready only after a real prompted inference | deterministic PNG-mask adapter |
| `image.layers` | Enhanced-only: unavailable until a reviewed local CUDA or authenticated remote backend completes a real decomposition | deterministic RGBA-layer adapter |
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

## Promotion into project history

Sidecar artifacts are temporary and must never be submitted as durable job
inputs by UUID alone. `POST /api/vision/promote` first reads sidecar metadata
over the loopback-only boundary, then requires the requested kind, MIME type,
and byte count to agree. It streams the content into the core content-addressed
asset directory while hashing it, probes image dimensions or MP4 metadata, and
creates a normal project-scoped asset row. SQLite receives only the core path,
media metadata, SHA-256, and JSON lineage; it never receives media bytes.

The promotion provenance identifies `vision-safe-motion`, the temporary
artifact ID/kind/MIME/size, the promotion timestamp, and caller-supplied parent
source/analysis IDs. The temporary sidecar ID is not a durable reference after
its cache TTL expires.

## Typography-safe motion pipeline

1. OCR returns every region, including low-confidence text, plus a dilated
   local safety-mask artifact.
2. Segmentation returns binary PNG masks under artifact IDs.
3. A generation plate is either the original flattened source with protected
   typography (`original-with-protected-text`) or, only when Qwen layer
   diagnostics pass and a real second OCR pass finds no residual protected
   text, a separately stored `layers-text-removed` PNG. Inpainting remains
   unavailable. Each result retains source, overlay, layer/second-pass analysis,
   hashes, dimensions, timestamp, and mode provenance.
4. The Safe Motion planner consumes normalized OCR/segmentation geometry plus
   a plate mode. It applies subject and camera movement relative to the fixed
   overlay, then reduces or rejects any swept collision, canvas escape, or
   camera movement that exposes a fixed-overlay edge. An initial overlap is
   allowed only for a stationary, explicit `behind-fixed-overlay` plan.
5. Overlay generation copies original image pixels in protected polygons into
   a full-canvas transparent PNG.
6. A MotionPackage records source and overlay IDs, a generation-plate mode,
   whether text was actually removed, protected-region provenance, the safe
   plan, and explicit `avoidTextGeneration`/`preserveComposition` hints. An
   original flattened slide is explicitly `original-with-protected-text`, never
   described as a clean plate, and receives a conservative motion budget.
7. FFmpeg can overlay the trusted PNG above a local MP4 while retaining source
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
npm run vision:sam2:smoke  # explicit local SAM 2 point/negative/box smoke
```

SAM 2 is a separate optional capability. Its adapter accepts user-supplied
positive/negative points and/or a bounding box; it does not claim to identify a
subject without a prompt. The provisioner downloads exactly the reviewed tiny
checkpoint to an external path and records a local SHA-256 manifest. It never
runs at sidecar startup or in CI.

```sh
/path/to/vision-venv/bin/python -m pip install -r services/vision/requirements.txt \
  -r services/vision/requirements/sam2.txt
/path/to/vision-venv/bin/python -m services.vision.sam2_provisioning \
  --destination "$HOME/Library/Application Support/Tiny Soho Studio/vision-runtime/sam2/sam2.1_hiera_tiny.pt" \
  --dry-run
```

After an explicit non-dry-run provision, configure
`TINY_SOHO_SAM2_ENABLED=1`, `TINY_SOHO_SAM2_CHECKPOINT_PATH`,
`TINY_SOHO_SAM2_MODEL_CONFIG`, `TINY_SOHO_SAM2_DEVICE`, and
`TINY_SOHO_SAM2_TIMEOUT_SECONDS`. The sidecar validates that returned masks are
binary, nonempty, and exactly source-sized before persisting them.
On the validated Apple Silicon target, `auto` uses CPU: SAM 2.1 tiny hit an
unsupported PyTorch MPS operator during a real inference. CUDA remains the
preferred automatic accelerator; use explicit `mps` only after a fresh MPS
smoke succeeds for the exact runtime/model combination.

Qwen Image Layered is never required for the Standard OCR/SAM path. The local
backend loads `QwenImageLayeredPipeline` only from an explicitly provisioned
directory, requires CUDA and a configurable free-VRAM floor, and uses the
official 4-layer/640 defaults. The remote backend accepts only a server-configured
HTTPS URL whose hostname is explicitly allowlisted alongside the server-only token,
sends decoded image bytes as bounded Base64,
does not follow redirects, and validates every returned PNG before use. Neither
backend downloads weights at request time. Returned layers must be RGBA and
share one canvas; the sidecar deterministically resizes Qwen's bucketed output
to the source canvas before it is stored. Recomposition reports a mean absolute
error and a 2% warning threshold. A material diagnostic failure is an unsafe
decomposition, not a successful Enhanced result.

This Apple Silicon target has no CUDA device and no configured remote backend,
so `image.layers` remains explicitly unavailable. That is the intended Standard
mode degradation, not a model failure hidden behind a fake response.

The Qwen local runtime candidate is pinned in `requirements/qwen.txt`, but is
not installed or exercised by CI. It needs an operator-provisioned model
directory outside this repository and a CUDA host. Its explicit smoke command
reports a warning rather than claiming pixel identity when recomposition differs
materially from the source.

## Smoke and verification

`python -m services.vision.integration_smoke` is a no-op by default. Only an
exact `TINY_SOHO_RUN_VISION_INTEGRATION=1` performs a loopback `/health` probe;
it does not invoke model inference. Tests use fake adapters and do not require
PyTorch, PaddleOCR, SAM 2, Qwen, or model weights.
