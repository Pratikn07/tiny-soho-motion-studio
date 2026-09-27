# Tiny Soho Vision local production runbook

## Scope and safety boundary

Tiny Soho Vision is a loopback-only local helper. The Next.js application and
durable generation worker continue to operate if the Python sidecar is stopped.
The sidecar binds only to `127.0.0.1`; it does not receive DashScope credentials,
does not alter SQLite, Supabase, quota accounting, or provider serialization, and
does not download optional runtimes or weights on startup.

All media remains on local disk. SQLite stores only metadata, paths, hashes, and
lineage. Do not put model weights, checkpoints, media files, or secrets in Git.

## Prerequisites

- Node.js 24 or later.
- Python 3.11.
- `ffmpeg` and `ffprobe` available on the local `PATH`, or configured through
  `FFMPEG_PATH` and `FFPROBE_PATH`.
- An owner-controlled application-data directory and, if Vision is used, an
  owner-controlled sidecar cache directory.

Create a dedicated Python environment outside the repository, then install only
the base sidecar dependencies:

```sh
python3.11 -m venv /owner-controlled/vision-venv
/owner-controlled/vision-venv/bin/python -m pip install -r services/vision/requirements.txt
```

The base installation intentionally excludes PyTorch, PaddleOCR, SAM 2, Qwen,
and all model weights/checkpoints.

## Configuration

Keep credentials in the owner-readable local configuration file created by
`npm run setup`; do not paste assignments into a shell or commit them. These
environment-variable names are supported:

```text
DASHSCOPE_API_KEY
ALIBABA_WORKSPACE_ID
FFMPEG_PATH
FFPROBE_PATH
TINY_SOHO_DATA_DIR
TINY_SOHO_VISION_PORT
TINY_SOHO_VISION_CACHE_DIR
TINY_SOHO_VISION_ARTIFACT_TTL_SECONDS
TINY_SOHO_VISION_MAX_UPLOAD_BYTES
TINY_SOHO_VISION_MAX_IMAGE_PIXELS
TINY_SOHO_PADDLE_OCR_ENABLED
TINY_SOHO_PADDLE_OCR_PROFILE
TINY_SOHO_PADDLE_OCR_DET_MODEL_DIR
TINY_SOHO_PADDLE_OCR_REC_MODEL_DIR
TINY_SOHO_SAM2_ENABLED
TINY_SOHO_SAM2_CHECKPOINT_PATH
TINY_SOHO_SAM2_MODEL_CONFIG
TINY_SOHO_SAM2_DEVICE
TINY_SOHO_QWEN_LAYERS_ENABLED
TINY_SOHO_QWEN_LAYERS_BACKEND
TINY_SOHO_QWEN_LAYERS_MODEL_PATH
TINY_SOHO_QWEN_LAYERS_REMOTE_URL
TINY_SOHO_QWEN_LAYERS_REMOTE_TOKEN
TINY_SOHO_QWEN_LAYERS_REMOTE_ALLOWED_HOSTS
```

`TINY_SOHO_QWEN_LAYERS_REMOTE_TOKEN` is server-only. Never expose it in the
browser, URL, logs, GitHub variables, or workflow output.

## Startup and health checks

Use separate terminals for the core app/worker and the optional sidecar:

```sh
npm start
```

```sh
source /owner-controlled/vision-venv/bin/activate
npm run vision:doctor
npm run vision:start
```

`vision:doctor` loads no model and downloads nothing. It reports the base
sidecar dependency presence (`fastapi`, `pillow`, `uvicorn`), configuration,
CPU/MPS/CUDA detection, and whether FFmpeg/ffprobe are runnable. A missing base
dependency means the operator must create the documented owner-controlled
environment before attempting a smoke; it is not an invitation for the app to
install anything automatically. With the
sidecar running, check the app and sidecar independently:

```sh
curl --fail http://127.0.0.1:3001/api/settings/status
curl --fail http://127.0.0.1:3001/api/vision/health
curl --fail http://127.0.0.1:3001/api/capabilities
curl --fail http://127.0.0.1:8765/health
curl --fail http://127.0.0.1:8765/v1/capabilities
```

An optional runtime is not available merely because a path is configured. It is
truthfully `ready` only after a real capability-specific smoke has succeeded.

## Optional runtime provisioning and smoke tests

Review the exact upstream pin, package license, model/checkpoint license,
hardware requirement, and storage path before opting into an optional runtime.
Weights and checkpoints must be provisioned into an owner-controlled directory
outside this repository. The sidecar does not fetch them automatically.

PaddleOCR, SAM 2, and Qwen use the separately reviewed optional requirement
files under `services/vision/requirements/`. Install only the runtime needed by
the target host, provision the reviewed files using the existing provisioners,
set the matching enable flag and paths, restart the sidecar, then run only its
explicit smoke command:

```sh
npm run vision:smoke
npm run vision:sam2:smoke
npm run vision:qwen:smoke
```

The three model commands may run inference only after that deliberate
provisioning. They never download a model themselves. On the current Apple
Silicon target, Qwen remains unavailable without a reviewed CUDA or approved
remote backend. SAM 2 uses CPU unless a fresh device-specific smoke proves a
different device works.

The local composition canary requires an explicit flag and uses generated test
media only:

```sh
TINY_SOHO_RUN_COMPOSE_SMOKE=1 npm run vision:compose:smoke
```

It proves FFmpeg/ffprobe can compose a raw MP4 and a fixed transparent overlay;
it invokes no model and no cloud provider.

## CI and release controls

The required `verify` check (shown as `CI / verify` in the GitHub UI) runs `npm ci`, the full Node test suite,
TypeScript checks, the production build, provenance/model-artifact validation,
base Python sidecar tests, and `git diff --check`. CI installs only
`services/vision/requirements.txt` and fails if PyTorch, PaddleOCR, SAM 2, or
Diffusers is present.

`Vision integration` is a separate manual or enabled-nightly self-hosted
workflow. Set the repository variables below only on an approved target runner:

```text
TINY_SOHO_VISION_PYTHON=/owner-controlled/vision-venv/bin/python
TINY_SOHO_VISION_NIGHTLY_PROFILE=real-ocr-smoke|real-sam2-smoke|real-qwen-smoke|compose-canary
```

The workflow performs no dependency installation or model provisioning. Its
selected smoke executes only the runtime already prepared on that machine.
Leave the nightly-profile variable unset to disable scheduled model work.

Before tagging a release, use a fresh checkout of `main`, run the required CI
commands locally, start the base sidecar, verify health/capabilities, and run
the compose smoke. Run real OCR/SAM/Qwen smoke only for enabled, provisioned
capabilities. A live Wan canary remains a manual operator action: run it only
after the exact model/workspace has confirmed Free Quota Only protection and a
separate explicit opt-in is recorded. Otherwise record it as skipped; never
substitute a paid model or automatic retry.

Configure `main` branch protection in GitHub after this PR is green: require
the `verify` status check, disallow force pushes, and disallow deletion
where the repository settings permit it.

## Rollback

Revert the smallest merged PR; do not reset shared history. Disable an optional
Vision capability with its `TINY_SOHO_*_ENABLED=0` flag or stop the sidecar.
This leaves the core app, existing generation studios, completed project assets,
and durable ambiguous jobs intact. Do not delete provider results or local
assets while reconciling an interrupted job. For an application-data restore,
use the existing SQLite backup before a migration and preserve media files
alongside the database metadata they reference.
