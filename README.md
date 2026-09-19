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

## Before generating

In Alibaba Model Studio, enable **Free Quota Only** for every model you intend to use. Then open **Settings** in Tiny Soho and confirm the enabled models. The app fails closed until that confirmation is recorded and never switches to a paid model.

## Included studios

- **Tiny Soho Motion:** upload clean backgrounds and keep typography/logo overlays local; select a background, plan motion, and generate a clean clip.
- **Image, Video, Cinema:** model-aware prompts, image reference input, and deterministic motion prompt presets.
- **Assets:** local project asset history and reuse.
- **Workflows:** local saved Layered carousel-to-video graph template.
- **Director:** drafts a structured motion proposal. It cannot submit media work.
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
