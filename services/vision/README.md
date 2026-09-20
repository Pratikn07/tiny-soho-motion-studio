# Tiny Soho Vision sidecar

This is a local-only FastAPI vision service. The base installation intentionally
ships no PaddleOCR, Qwen Image Layered, SAM 2, PyTorch, or model checkpoint
dependency. Starting the service neither installs packages nor downloads model
weights.

## Run locally

```sh
python3 -m venv .vision-venv
.vision-venv/bin/python -m pip install -r services/vision/requirements.txt
.vision-venv/bin/python -m services.vision.app
```

The service always binds to `127.0.0.1` (default port `8765`). Set
`TINY_SOHO_VISION_PORT` to select a different valid local port. The Next.js
application treats the service as optional: its normal UI and APIs continue to
operate if this process is stopped.

## Read-only API

- `GET /health` reports the loopback bind target and CPU/MPS/CUDA availability.
- `GET /v1/capabilities` returns the shared, versioned capability manifest and
  the current hardware preflight.

The shared manifest is [`lib/capabilities/manifest.json`](../../lib/capabilities/manifest.json).
It pins upstream source commits and records code and model/checkpoint licensing
separately. It is provenance metadata only; it does not enable inference.

## Optional OCR runtime

`requirements/ocr.txt` pins the optional PaddleOCR package and is never
installed by the base requirements or CI. The current adapter remains
unavailable until an operator supplies a separately reviewed checkpoint with a
verified license. No code path downloads checkpoints automatically.

`requirements/sam2.txt` is also opt-in and excluded from base CI. It pins the
SAM 2 source with torch/torchvision versions; use
`python -m services.vision.sam2_provisioning --destination /external/path --dry-run`
to inspect the reviewed checkpoint before explicitly downloading it. Configure
`TINY_SOHO_SAM2_CHECKPOINT_PATH`, `TINY_SOHO_SAM2_MODEL_CONFIG`, and
`TINY_SOHO_SAM2_DEVICE` only after that review; the sidecar never fetches it.

`requirements/qwen.txt` is opt-in and excluded from base CI. Qwen Image
Layered supports a local CUDA backend configured with
`TINY_SOHO_QWEN_LAYERS_MODEL_PATH`, or a separately reviewed server-side HTTPS
backend configured with `TINY_SOHO_QWEN_LAYERS_REMOTE_URL` and the server-only
`TINY_SOHO_QWEN_LAYERS_REMOTE_TOKEN`; the endpoint hostname must also appear
in `TINY_SOHO_QWEN_LAYERS_REMOTE_ALLOWED_HOSTS`. Neither mode is available until a real
decomposition succeeds; the sidecar never fetches weights and never sends the
remote token to a browser. `npm run vision:qwen:smoke` is an explicit real
decomposition check; it cannot provision a runtime or fetch weights.

`POST /v1/compose` accepts only owned MP4 and PNG artifact IDs. It resolves
their server-side paths, validates their dimensions with FFprobe, then invokes
FFmpeg with an argument array; it never accepts browser filesystem paths or a
shell command. Generated MP4s are adopted atomically from sidecar-owned
temporary files, so composition does not load the completed video into Python
memory.

`POST /v1/plates` accepts only sidecar-owned source-image, trusted-overlay, and
optional RGBA-layer artifact IDs. It verifies the overlay's dimensions, safety
coverage, and exact protected source pixels. It uses the original source by default. A text-removed
plate is emitted only when Qwen recomposition diagnostics pass, a text-like
layer overlaps OCR protection, and a real second OCR pass finds no protected
text left. If any check is unavailable or fails, it returns the original plate
with truthful warnings; it never claims inpainting is available.

## Artifact limits

`TINY_SOHO_VISION_MAX_UPLOAD_BYTES` defaults to 16 MB and limits browser image
uploads. `TINY_SOHO_VISION_MAX_IMAGE_ARTIFACT_BYTES` defaults to 64 MB for
masks, overlays, and RGBA layers. `TINY_SOHO_VISION_MAX_VIDEO_ARTIFACT_BYTES`
defaults to 1 GB for locally composed MP4 output. The sidecar validates image
uploads before persistence and accepts video output only from its own private
temporary directory; browser requests never choose a filesystem path.

For the full artifact lifecycle, optional-runtime policy, and typography-safe
motion flow, see [`docs/vision/architecture.md`](../../docs/vision/architecture.md).
