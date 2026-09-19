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

## Architecture

The browser talks only to local `/api/*` routes. SQLite and media live under `~/Library/Application Support/Tiny Soho Studio` by default. A separate worker process submits and polls durable Alibaba jobs every 15 seconds. Provider result URLs are downloaded without forwarding the DashScope authorization header.

## Verification

```bash
npm test
npm run check
npm run build
```

No live generation is performed by setup, tests, or build. Live capability remains dependent on your Alibaba account, regional model access, and free quota.

## Attribution

This repository was originally derived from Open Generative AI. The active runtime has been rewritten as a local Next.js application; unused Vite, Electron, MuAPI, and hosted-workflow material has been removed. The retained upstream MIT license remains in [LICENSE](LICENSE).
