# Tiny Soho Vision Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local, typography-safe Vision pipeline from validated image input through a deterministic MotionPackage and local preview, without changing Tiny Soho production generation infrastructure.

**Architecture:** Next.js routes accept only validated local multipart uploads and proxy them to a loopback FastAPI sidecar. The sidecar owns opaque temporary artifacts, optional/lazy model adapters, and model runtime state; TypeScript owns the portable SafeMotionPlan, collision analysis, MotionPackage, and experimental UI. No model is required for the contracts to run: unavailable adapters report a truthful reason and test fakes exercise every result path.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zod, FastAPI, Pydantic, Pillow, FFmpeg/ffprobe, optional isolated Python inference dependencies, Vitest, unittest/HTTPX.

**Spec:** `/Users/pratik.nandoskar/.codex/attachments/df331848-52c3-4d97-88ea-422108fb7084/pasted-text-1.txt`

## Global Constraints

- Work only on `codex/vision-inference`; keep PR #1 (`codex/vision-stack`) reviewable and unmodified.
- Never modify `supabase/`, `lib/store.ts`, `lib/assets.ts`, `server/worker.ts`, `lib/generation.ts`, `lib/provider.ts`, `lib/providers/`, quota accounting, or production database code.
- The sidecar binds only to `127.0.0.1`; Next rejects non-loopback sidecar URLs.
- Do not commit credentials, model weights, checkpoints, generated media, or artifacts; do not submit Wan jobs.
- Base CI installs only the lightweight sidecar requirements. Optional model runtimes are opt-in and must not download weights automatically.
- Every external coordinate is normalized to `0..1`; browser input never becomes an arbitrary local filesystem path.

---

### Task 1: Vision foundations and provenance

**Files:**
- Create: `services/vision/config.py`, `services/vision/schemas/common.py`, `services/vision/runtime/registry.py`, `services/vision/runtime/locks.py`, `docs/vision/upstream-provenance.json`
- Modify: `services/vision/app.py`, `lib/capabilities/manifest.json`, `lib/capabilities/schema.ts`, `.gitignore`, `services/vision/requirements.txt`, `services/vision/README.md`
- Test: `services/vision/tests/test_runtime.py`, `tests/capabilities.test.ts`

**Interfaces:**
- Produces `VisionConfig.from_env()`, `RuntimeRegistry.status(capability_id)`, `ModelState` (`unloaded|loading|ready|error`), and a capability response that separates static provenance from runtime availability.
- Consumes no optional model package at import or startup.

- [ ] Write failing tests proving a missing optional model reports `unavailable`, each capability has machine-readable provenance, and a registry state transition is serialized.
- [ ] Implement immutable configuration with bounded upload/artifact limits, a per-capability async lock registry, and dynamic status overlays.
- [ ] Add provenance records for the pinned PaddleOCR, SAM 2, and Qwen source commits; leave an unverified checkpoint explicitly unselected rather than guessing a license.
- [ ] Add ignore rules for model weights and known model caches without ignoring `tests/fixtures/vision`.
- [ ] Run the focused Python and TypeScript tests, then commit `feat: add vision runtime foundations`.

### Task 2: Opaque artifacts and image validation

**Files:**
- Create: `services/vision/artifacts/manager.py`, `services/vision/schemas/artifacts.py`, `services/vision/image_input.py`, `app/api/vision/artifacts/[id]/route.ts`, `lib/vision/artifacts.ts`
- Modify: `services/vision/app.py`, `lib/vision/client.ts`
- Test: `services/vision/tests/test_artifacts.py`, `tests/vision-artifacts.test.ts`

**Interfaces:**
- Produces `ArtifactMetadata`, `ArtifactManager.write_bytes(kind, mime_type, data)`, `ArtifactManager.open(id)`, and `GET /v1/artifacts/{id}`.
- Image validation accepts PNG/JPEG/WebP bytes only and returns decoded dimensions; it rejects empty, oversized, malformed, unknown MIME, and over-pixel-limit inputs.

- [ ] Write focused failing tests for opaque IDs, path traversal rejection, atomic artifact writes, expiry cleanup, safe MIME, and decoded image limits.
- [ ] Implement an OS-cache-root artifact manager using UUIDs, temp-file-plus-rename writes, size bounds, TTL cleanup, and an ID-only read API.
- [ ] Implement byte-based image decoding through Pillow; do not accept paths, URLs, Base64, or user file names as input locations.
- [ ] Add the local Next artifact proxy, which validates an opaque UUID and forwards only the sidecar result body/content type.
- [ ] Run artifact tests and commit `feat: add safe vision artifacts`.

### Task 3: OCR contracts, fake adapter, and typography safety masks

**Files:**
- Create: `services/vision/schemas/ocr.py`, `services/vision/adapters/base.py`, `services/vision/adapters/paddle_ocr.py`, `services/vision/typography.py`, `services/vision/requirements/ocr.txt`, `lib/vision/contracts.ts`, `lib/vision/ocr.ts`, `app/api/vision/ocr/route.ts`
- Modify: `services/vision/app.py`, `services/vision/README.md`, `docs/vision/upstream-provenance.json`
- Test: `services/vision/tests/test_ocr_contract.py`, `tests/vision-ocr.test.ts`

**Interfaces:**
- Produces `OcrResult`, normalized `OcrRegion`, `TypographySafetyMask`, `POST /v1/ocr`, and `POST /api/vision/ocr`.
- `PaddleOcrAdapter` loads only after explicit enablement and returns a verified unavailable result until a licensed checkpoint/runtime is configured; `FakeOcrAdapter` supplies deterministic test regions.

- [ ] Write failing tests for normalized polygons, low recognition confidence preservation, empty/malformed adapter results, multiple/rotated regions, invalid image rejection, dilation, and mask dimensions.
- [ ] Implement the adapter abstraction and a fake adapter without importing PaddleOCR at module load.
- [ ] Implement `POST /v1/ocr` multipart upload validation and typed response; make the Next route forward only local validated file bytes to the loopback sidecar.
- [ ] Implement polygon rasterization and `clamp(round(min(width,height)*0.01), 2, 64)` dilation; persist the resulting PNG as an opaque mask artifact.
- [ ] Record the selected, verified PaddleOCR inference/checkpoint information or retain an explicit no-checkpoint reason; run optional smoke only when enabled.
- [ ] Run tests and commit `feat: add OCR vision adapter contracts`.

### Task 4: Promptable segmentation and mask artifacts

**Files:**
- Create: `services/vision/schemas/segmentation.py`, `services/vision/adapters/sam2.py`, `services/vision/requirements/sam2.txt`, `lib/vision/segmentation.ts`, `app/api/vision/segment/route.ts`
- Modify: `services/vision/app.py`, `docs/vision/upstream-provenance.json`, `services/vision/README.md`
- Test: `services/vision/tests/test_segment_contract.py`, `tests/vision-segmentation.test.ts`

**Interfaces:**
- Produces `SegmentationRequest` with normalized point/box prompts, `SegmentationResult`, mask `artifactId`s, and `POST /v1/segment`/`POST /api/vision/segment`.
- `Sam2Adapter` has a lazy optional implementation; `FakeSegmentationAdapter` emits deterministic, opaque PNG masks for contract tests.

- [ ] Write failing tests for positive/negative points, normalized box bounds, invalid coordinates, unavailable runtime, artifact-backed masks, and metadata.
- [ ] Implement request validation and a fake mask backend; return binary mask artifacts rather than JSON pixel arrays.
- [ ] Add the lazy SAM 2 runtime adapter behind an explicit enable flag and documented pre-existing checkpoint path; do not download a checkpoint automatically.
- [ ] Run a real CPU/MPS smoke only when the optional runtime/checkpoint have verified provenance; otherwise record the truthful unavailable result.
- [ ] Run tests and commit `feat: add promptable segmentation contracts`.

### Task 5: Qwen layer abstraction and diagnostics

**Files:**
- Create: `services/vision/schemas/layers.py`, `services/vision/adapters/qwen_layers.py`, `services/vision/requirements/qwen.txt`, `services/vision/layers.py`, `lib/vision/layers.ts`, `app/api/vision/layers/route.ts`
- Modify: `services/vision/app.py`, `docs/vision/upstream-provenance.json`, `services/vision/README.md`
- Test: `services/vision/tests/test_layers_contract.py`, `tests/vision-layers.test.ts`

**Interfaces:**
- Produces `LayerBackend`, `LayerResult`, RGBA layer artifact IDs, deterministic fake layers, recomposition diagnostics, and `POST /v1/layers`/`POST /api/vision/layers`.
- Local Qwen requires explicit enablement and a supported CUDA setup; default behavior is `unavailable` without model import or download.

- [ ] Write failing tests for unavailable Qwen, fake RGBA layers, alpha coverage, artifact IDs, dimensions, z-order, and recomposition metadata.
- [ ] Implement `UnavailableQwenBackend`, `FakeQwenBackend`, and a configured but lazy local CUDA backend boundary.
- [ ] Implement alpha-aware recomposition and non-authoritative OCR/SAM overlap classification; preserve raw layer evidence.
- [ ] Run tests and commit `feat: add layered image backend contracts`.

### Task 6: Safe Motion geometry and collision planner

**Files:**
- Create: `lib/safe-motion/schema.ts`, `lib/safe-motion/masks.ts`, `lib/safe-motion/collision.ts`, `lib/safe-motion/planner.ts`, `lib/safe-motion/typography.ts`, `lib/safe-motion/validation.ts`
- Test: `tests/safe-motion.test.ts`

**Interfaces:**
- Produces serializable `SafeMotionPlan`, `createSafeMotionPlan(input)`, `sweptBounds(subject, motion)`, and collision reports with requested/final motion.
- Consumes normalized OCR regions and segmentation bounds only; it has no Wan/provider dependency.

- [ ] Write failing tests for collision-free motion, typography collision, automatic conservative reduction, unsafe/rejected motion, and typography-always-on-top policy.
- [ ] Implement conservative rectangle-envelope collision maths, configurable thresholds, normalized camera/subject motion, deterministic reduction steps, warnings, and provenance-friendly corrections.
- [ ] Run tests and commit `feat: add typography-safe motion planner`.

### Task 7: Trusted overlay, MotionPackage, and generation draft bridge

**Files:**
- Create: `lib/safe-motion/motion-package.ts`, `lib/safe-motion/prompt.ts`, `lib/safe-motion/bridge.ts`, `services/vision/overlay.py`
- Test: `tests/motion-package.test.ts`, `services/vision/tests/test_overlay.py`

**Interfaces:**
- Produces `TypographyOverlay`, `MotionPackage`, `buildWanCompatiblePrompt(pkg)`, and `MockVisionGenerationBridge.prepare(pkg)`.
- Python overlay generation creates a full-canvas transparent PNG with original source pixels inside protected regions; it does not use AI text generation.

- [ ] Write failing tests for trusted overlay positioning/source dimensions, MotionPackage schema validity, deterministic prompt language, and a mock bridge that never submits a job.
- [ ] Implement original-region-patch overlay generation from an artifact source image and safety regions.
- [ ] Implement pure MotionPackage and prompt builder contracts with explicit `avoidTextGeneration` and `preserveComposition` hints.
- [ ] Run tests and commit `feat: add typography-safe motion package`.

### Task 8: Standalone FFmpeg typography composer and local preview contract

**Files:**
- Create: `services/vision/composition.py`, `lib/vision/composer.ts`, `lib/vision/preview.ts`
- Test: `services/vision/tests/test_composition.py`, `tests/vision-composer.test.ts`

**Interfaces:**
- Produces `build_overlay_command(video_path, overlay_path, output_path)`, safe artifact-owned composition inputs, and deterministic browser preview transform data.
- FFmpeg commands are argument arrays, preserve optional source audio, retain a fixed overlay, and never interpolate browser paths into a shell.

- [ ] Write failing tests for command construction, dimension mismatch rejection, audio mapping, fixed overlay z-order, and no shell interpolation.
- [ ] Implement standalone composition from opaque artifact IDs and a pure preview transform model; do not alter production export APIs.
- [ ] Run tests and commit `feat: add local typography composition`.

### Task 9: Experimental Vision Lab and fixture workflow

**Files:**
- Create: `app/vision-lab/page.tsx`, `app/vision-lab/vision-lab.tsx`, `tests/fixtures/vision/*.png`, `tests/vision-lab.test.ts`
- Modify: `app/page.tsx` only to add an Experimental Vision Lab navigation entry if one exists without replacing Studio flows.

**Interfaces:**
- The lab consumes only `/api/vision/*` typed routes and renders `idle|validating|loading-model|processing|success|unavailable|error` states.
- It provides local upload, capability status, OCR polygons/protection, promptable subject request controls, layers status/result inspection, motion-plan/collision preview, overlay inspection, and MotionPackage JSON.

- [ ] Create non-private small PNG fixtures representing headline/subject, food/multiple objects, and difficult text overlap.
- [ ] Write failing browser-independent component/route tests for unavailable states and returned plan display.
- [ ] Implement the clearly marked Experimental UI with no cloud-generation control or telemetry.
- [ ] Run tests/build and commit `feat: add experimental vision lab`.

### Task 10: Documentation, opt-in smoke runner, and final audit

**Files:**
- Create: `docs/vision/architecture.md`, `services/vision/integration_smoke.py`
- Modify: `services/vision/README.md`, `docs/vision/upstream-provenance.json`
- Test: all Node and Python suites, optional smoke runner only with `TINY_SOHO_RUN_VISION_INTEGRATION=1`

**Interfaces:**
- Smoke output records model/backend/runtime, load/inference duration, dimensions, and warnings without image bytes, secrets, or full filesystem paths.

- [ ] Document pipeline, artifact privacy, optional dependency install, explicit model/checkpoint setup, local cache cleanup, and truthful availability semantics.
- [ ] Implement an opt-in smoke runner that exits without model activity unless the integration environment variable is exactly `1`.
- [ ] Inspect every protected path for accidental edits; run `npm test`, `npm run check`, `npm run build`, base Python tests, `git diff --check`, and permitted real local integration probes.
- [ ] Commit the final documentation/audit changes and report model/hardware/license/infrastructure blockers separately.
