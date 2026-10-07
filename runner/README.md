# Studio Mac runner

Runs reel jobs for Tiny Soho Studio on this Mac. It checks in every 20 seconds (the Studio shows
"Studio Mac · online"), claims the oldest waiting reel job, works on it, and reports back. While the Mac
sleeps, jobs wait in the queue and start when it wakes.

- **Claude usage:** only the thinking steps call Claude Code (`claude -p`, your login). Renders, mixes and
  file work are plain scripts and use none.
- **Creators never need a Claude login.** They use the website; the runner works under yours. Switch
  `TINY_SOHO_CLAUDE_AUTH` to `api_key` (with an Anthropic API key in Claude Code) when creators join.
- **Built so far:** the job loop, leases and status, and the Idea step (three story ideas). Other steps report
  `step_not_ready` until they're added to `handlers.mjs`.

## Set up
1. Vercel (Production): `TINY_SOHO_RUNNER_TOKEN` (a random 48+ character secret) and
   `TINY_SOHO_RUNNER_OWNER_ID` (the owner's Supabase user id). Redeploy.
2. This Mac: copy `runner.env.example` to `~/.config/tiny-soho/runner.env` and set the same token.
3. Run once in a terminal to check it: `node runner/runner.mjs`
4. Install it to start at login and restart if it stops: `sh runner/install.sh`

Keep the Mac plugged in and awake while reels are being made.
