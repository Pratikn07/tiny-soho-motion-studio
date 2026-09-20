# Tiny Soho Creative Studio

Local, browser-based creative studio for Alibaba Model Studio in Singapore. It keeps API credentials on the server, stores projects and media on your Mac, and uses an approval-first workflow for generation.

## Start

```bash
cd /Users/pratik.nandoskar/Documents/working/mch/tiny-soho-studio
npm install
npm run setup
npm run dev
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001).

`npm run setup` checks FFmpeg and asks for your Singapore workspace ID and DashScope key. It writes a local, gitignored `.env` with owner-only permissions. Do not put keys in the browser or source code.

## Optional Tiny Soho creative knowledge

Creative-knowledge retrieval is temporarily disabled while its Supabase read boundary is remediated. The previous publishable-key Data API reader is deliberately fail-closed: a local browser app must not imply that an anonymous table reader is private simply because the key stays on the Next.js server.

TS-R01 selected a dedicated, server-only database reader role. The exact **unapplied** proposal and the audit basis are in [the knowledge-access decision](docs/architecture/tiny-soho-knowledge-access.md). Do not run it or add Supabase credentials to `.env` until TS-R02 implements the private reader and you explicitly approve the production migration.

Until then, the Director continues to draft without external Tiny Soho evidence and never fabricates citations.

## Before generating

In Alibaba Model Studio, enable **Free Quota Only** for every model you intend to use. Then open **Settings** in Tiny Soho and check only those exact models. The app records a per-model confirmation timestamp, fails closed for every unconfirmed model, and never switches to a paid model.

## Generation safety

Every submission follows one local path:

```text
Studio / Storyboard / Director / Workflow
  → normalized GenerationDraft
  → model and asset preflight
  → durable idempotent job
  → background worker
  → Alibaba model-specific serializer
```

The browser uses internal media roles such as `start-image` and `end-image`. Only the Alibaba adapter turns those into provider wire fields such as `first_frame` and `last_frame`.

- Wan 2.7 I2V accepts a start frame or a start-and-end pair, at 2–15 seconds and 720P/1080P.
- Wan 3 accepts text-only, start-frame, start-and-end, and image-reference requests at 2–30 seconds or smart duration, with model-aware resolution and ratio controls.
- The worker refuses a job whose stored media roles are incomplete; it does not infer provider inputs.
- Director proposals are schema-validated and preflight every shot before approval mutates state or queues work.
- Workflow generation waits for explicit completed dependency edges and preserves checkpoints across restarts.

## Included studios

- **Tiny Soho Motion:** upload clean backgrounds and keep typography/logo overlays local; select a background, plan motion, and generate a clean clip.
- **Image, Video, Cinema:** model-aware prompts, image reference input, and deterministic motion prompt presets.
- **Assets:** local project asset history and reuse.
- **Workflows:** a local graph editor with explicit asset-to-generation media edges and durable checkpoints.
- **Director:** drafts a schema-validated motion proposal. It cannot submit media work without a separate one-shot approval.
- **Local export API:** `POST /api/exports` accepts completed local video asset IDs and an optional transparent typography overlay; it uses FFmpeg to compose the overlay and encode a local H.264 export. This is intentionally server-side so text layers never leave the Mac.
- **MotionPackageV2 validation:** `POST /api/vision/motion-packages` validates a persistent source image, generation plate, and transparent typography overlay against one project and the existing generation preflight. It does not create or submit a job; the later Vision Generation Bridge owns that approved action.
- **Vision Generation Bridge:** `POST /api/vision/motion-packages/generate` revalidates a MotionPackageV2 and queues it through the same quota-aware GenerationDraft/preflight path as every other studio entry point. It accepts one explicit generation-attempt ID, uses the persistent generation plate only as the first frame, limits carousel motion to 3–5 seconds, and keeps package lineage local rather than sending it to Alibaba.
- **Final typography composition:** `POST /api/vision/motion-packages/compose` accepts a completed, lineage-matched raw Wan MP4 plus its MotionPackageV2. The core FFmpeg path verifies the trusted transparent PNG against its source pixels, rejects dimension mismatches, composites fixed typography over the video, checks a lossy H.264 frame within visual tolerance, and atomically adopts the final project asset. The Python sidecar composition route remains diagnostic-only.
- **Experimental Vision Lab:** select a project image or upload one locally; run only currently configured OCR, optional segmentation, and optional layer analysis; preserve the trusted typography overlay; promote reviewed artifacts into the project; preflight a persistent MotionPackageV2; explicitly queue one guarded Wan request; then compose the original overlay over the completed raw MP4. The browser never receives provider credentials or sends temporary sidecar IDs to Alibaba.

## Architecture

The browser talks only to local `/api/*` routes. SQLite and media live under `~/Library/Application Support/Tiny Soho Studio` by default. A separate worker process submits and polls durable Alibaba jobs every 15 seconds. Provider result URLs are downloaded without forwarding the DashScope authorization header.

## Core media recovery

Core asset handling has separate limits for browser uploads (25 MB), provider
results (500 MB), and local exports (1 GB). Provider results are accepted only
from exact HTTPS Alibaba storage domain boundaries, are streamed to a local
temporary file with a hard ceiling and SHA-256 hash, then decoded/probed before
being atomically adopted as a content-addressed local asset. Redirects and
unrecognised content types are rejected; provider credentials are never sent to
the result host.

SQLite uses `migrations/001_baseline.sql` and `PRAGMA user_version` within an
immediate transaction. On worker startup, a job interrupted during submission
becomes `submission_unknown` and a job interrupted during local result handling
becomes `needs_attention`; neither is silently resubmitted. Only a still-queued
job can be canceled locally. A provider-submitted job may continue consuming
quota even if its downstream handling is stopped.

## Verification

```bash
npm test
npm run check
npm run build
```

No live generation is performed by setup, tests, or build. Live capability remains dependent on your Alibaba account, regional model access, and free quota.

## Attribution

This repository was originally derived from Open Generative AI. The active runtime has been rewritten as a local Next.js application; unused Vite, Electron, MuAPI, and hosted-workflow material has been removed. The retained upstream MIT license remains in [LICENSE](LICENSE).
