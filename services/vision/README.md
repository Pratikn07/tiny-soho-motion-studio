# Tiny Soho Vision sidecar

This is a local-only FastAPI preflight service. VISION-01 through VISION-03
intentionally ship no PaddleOCR, Qwen Image Layered, SAM 2, PyTorch, or model
checkpoint dependency. Starting the service neither installs packages nor
downloads model weights.

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

`requirements/sam2.txt` is also opt-in and excluded from base CI. It may only
be used after an operator has supplied a reviewed checkpoint through
`TINY_SOHO_SAM2_CHECKPOINT_PATH`; the sidecar never fetches it.
