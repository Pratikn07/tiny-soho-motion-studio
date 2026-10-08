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
  the image list, then a rough SVG sketch per scene, drawn three at a time at low effort). Other steps report
  `step_not_ready` until they're added to `handlers.mjs`.
- **Tools:** Claude gets no tools for ideas and scripts. It may use `Read` (the reference reel's frames, in a temp
  folder) and `WebFetch` (only when the creator added reference links) for the reference and storyboard steps.
- **Motion library:** `motion-library.md` ships with the runner and goes into every look and storyboard prompt:
  styles sorted for the brand, treatments, moves and transitions from prompt-motion.com and motionin.design.
  Edit it to change what the Mac suggests, then update the installed runner.
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
