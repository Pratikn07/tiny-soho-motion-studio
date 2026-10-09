# Studio Mac runner

Runs reel jobs for Tiny Soho Studio on this Mac. It checks in every 20 seconds (the Studio shows
"Studio Mac · online"), claims the oldest waiting reel job, works on it, and reports back. While the Mac
sleeps, jobs wait in the queue and start when it wakes.

- **Claude usage:** only the thinking steps call Claude Code (`claude -p`, your login). Renders, mixes and
  file work are plain scripts and use none.
- **Creators never need a Claude login.** They use the website; the runner works under yours. Switch
  `TINY_SOHO_CLAUDE_AUTH` to `api_key` (with an Anthropic API key in Claude Code) when creators join.
- **Built so far:** the job loop, leases and status; Idea (three story ideas, or a breakdown of a reference reel);
  Script (from an idea or a pasted brief, keeping a brief's script draft); Storyboard (the look, then scenes and
  the image list, then a rough SVG sketch per scene, drawn three at a time at low effort); Images (a look at each
  uploaded image against its prompt, via a link made when the job is claimed); Voice (two takes in the cloned
  ElevenLabs voice, line by line, joined with ffmpeg, word-timed and checked for cues read aloud; see `voice.mjs`).
  Other steps report
  `step_not_ready` until they're added to `handlers.mjs`.
- **Tools:** Claude gets no tools for ideas and scripts. It may use `Read` (the reference reel's frames, in a temp
  folder) and `WebFetch` (only when the creator added reference links) for the reference and storyboard steps.
- **Motion library:** `motion-library.md` ships with the runner and goes into every look and storyboard prompt:
  styles sorted for the brand, treatments, moves and transitions from prompt-motion.com and motionin.design.
  Edit it to change what the Mac suggests, then update the installed runner.
- **Voice needs** `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `runner.env` (see `runner.env.example`). Takes
  are uploaded to the reel's storage folder through a one-time link from the Studio. Line recordings stay in
  `~/.cache/tiny-soho/voice/<reel>/<take>/`, so redoing a line re-voices only that line.
- **Build, Sound and Export** work in Studio's own copy of the motion engine: a git worktree of
  `~/Documents/working/mch/tiny-soho-reels` on branch `studio`, at `~/Documents/working/mch/tiny-soho-reels-studio`
  (or `TINY_SOHO_ENGINE_DIR`). A reel gets a number from 03 up and only ever writes its own files
  (`timelines/rNN.ts`, `scenes/rNN_*.ts`, `data/reelNN`, `audio/reelNN`, `public/hf/reelNN`, plus new `rNN_*` effects in
  `audio/library`); each build and sound pass is committed on `studio`, never pushed, and never touches `main`.
  - **Build** (`build.mjs`): sets up the reel's voice, word timings (`lyrics.json` from the take, `audio.json` via
    `analysis/audio_vo.py`) and images; Claude Code writes the timeline and scenes (tools limited to reading,
    writing, and `bun app/scripts/render.ts`); every scene must render without errors; a quick 30 fps preview is
    rendered, shrunk to 540×960 and uploaded with one still per scene. Usually 10–30 minutes; the Mac is kept awake.
  - **Sound** (`sound.mjs`): ElevenLabs Music for a new instrumental bed, Claude places one effect per on-screen action
    on its word, each generated with ElevenLabs sound effects and recorded in `audio/library/index.json`; mixed by
    `analysis/mix_studio.py` to -14 LUFS and muxed onto the build preview. "Music level" only remixes (no credits).
  - **Export** (`export.mjs`): the final render (30 fps, motion blur, reel 01's settings), the mix added, the cover
    (opening frame) and a caption, uploaded for download. Usually 10–25 minutes.
- **Are.na boards:** the Mac keeps them itself with the `arena` CLI (signed in on this Mac: `arena login`). Each series
  has a private channel "Tiny Soho · <Series>" ("Tiny Soho · Standalone" for the rest), found on the account or created.
  On a reel's first look job the Mac finds public channels that fit the brief (Are.na's public channel search, plus
  channels the board's pins already sit in), shows Claude up to 48 candidates on numbered contact sheets, and connects
  the 8-12 it picks to the board tagged `studio_reel=<reel>`. It adds more when you turn down every look. Look and
  storyboard jobs then read up to 12 of the board's images, this reel's first, plus any channel you link. Delete a pin
  on Are.na and it is never used again. `TINY_SOHO_ARENA_BOARDS=off` stops it. See `arena-board.mjs` and `arena.mjs`.
- **Reference reels need** `yt-dlp`, `ffmpeg` and `uv` on this Mac (`brew install yt-dlp ffmpeg uv`). The voice is
  transcribed with faster-whisper through uv; the first run downloads the model. If transcription fails, the
  breakdown still runs from the frames. Downloads are deleted when the job ends.

## Set up
1. Vercel (Production): `TINY_SOHO_RUNNER_TOKEN` (a random 48+ character secret) and
   `TINY_SOHO_RUNNER_OWNER_ID` (the owner's Supabase user id). Redeploy.
2. This Mac: copy `runner.env.example` to `~/.config/tiny-soho/runner.env` and set the same token.
3. Run once in a terminal to check it: `node runner/runner.mjs`
4. Install it to start at login and restart if it stops: `sh runner/install.sh`

Keep the Mac plugged in and awake while reels are being made.
