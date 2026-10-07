# Tiny Soho Reels: handoff

This is everything decided and built between 5 and 7 October 2026 in one Claude Code conversation. It
covers the first motion-graphics reel for @tinysoho ("It's Not the Sugar") and the Reels section of this
studio (`hosted/`), which turns that hand-made process into a step-by-step flow. It is written for another
AI agent picking up the work. Read "Rules" first, then the part you need.

Status on 7 Oct 2026:
- Reel 01 is finished as a local file.
- The studio has a new four-section shell (Reels, Carousels, Library, Creations).
- Reel job tables are in Supabase.
- A runner on the owner's Mac picks up jobs.
- The Idea and Script steps work in production; Storyboard through Export are not built yet.

Companion file: [`reel01-style-sheet.md`](reel01-style-sheet.md), a copy of the reel project's style sheet.

---

## 1. Rules for any agent working on this

- **This repo is public.** Never commit keys, tokens, owner ids, personal data or children's photos.
- **Database: ask first.** The only Supabase project is the shared `insta-automation` one, also used by
  the Instagram app. No staging, no backups. Follow the "Database: ask first" section of the root
  `CLAUDE.md` exactly: an explicit yes in chat, then a clean `origin/main` checkout, `supabase migration
  list --linked`, `supabase db push --dry-run`, a schema-only dump, the push, and `supabase unlink`.
- **Never commit or push unless the owner asks.** Approval for one PR does not carry to the next.
- **Shared checkout.** Other agents use the main checkout. Work in a worktree on a branch from
  `origin/main`, and run `git branch --show-current` before editing.
- **Production deploys** of `hosted/` go to Vercel from a clean export of `origin/main`. See §7.
- **The owner wants to approve each step** before the next one starts, both in the product and when
  working with them. Brainstorm first; build only after a clear go-ahead.
- **Children:** the cast (Anaika, the toddler, and her mum) is AI-generated, per the owner. Do not copy
  real children's photos (for example carousel inputs from `tiny-soho-motion-runtime`) anywhere else.

---

## 2. Timeline

| When | What happened |
|---|---|
| 5 Oct | Analysed three reference reels frame by frame. Brainstormed story ideas (no recipes). Fixed the ElevenLabs connector. Tuned the cloned voice on `eleven_v4` |
| 5 Oct | Settled brand and type, wrote the script, generated the voice, imported the Motion-as-Code kit and converted it to 9:16. Generated Higgsfield images, built 8 scenes, added score and sound effects, rendered `reel01-final.mp4` |
| 7 Oct, morning | Moved the conversation to this repo. Designed the Studio redesign (Carousels + Reels), chose where Claude runs, made a clickable mock |
| 7 Oct | PR #74 (app shell) and PR #75 (reel tables and Mac runner) merged and deployed. Migration applied to Supabase |
| 7 Oct, evening | Runner installed as a login agent. PR #76 (Idea and Script screens) merged and deployed |
| 7 Oct, late | Discussed moving the runner to Railway, and a Brainstorm chat with file uploads. Both are proposals, not built (§9) |

---

## 3. Reference reels and what we took from them

The owner shared three Instagram reels. Frames were pulled at 2 fps plus scene changes with `yt-dlp` and
`ffmpeg`. Audio was not transcribed then.

1. **`instagram.com/p/DeHc5pESvey`** (creator workflow, 60s). A talking head showing a storyboard page
   Claude built: about 10 numbered frames, each with a time range, a thumbnail and its script line. The
   takeaway was the process: script → timed storyboard → make each frame → animate.
2. **`instagram.com/p/DeCSaeVzNio`** (illustrated film, 57s). About 22 oil-pastel shots, animated with an
   AI video tool. The graphics on top are drawable in code: sticky-note title, handwritten red words, a
   crossed-out word, a split screen, and a loop diagram with a travelling dot.
3. **`instagram.com/p/DeEoDBASC5R`** (collage card explainer, 59s). **This is the chosen style.** One scene
   per sentence (about 2.5s each) on textured paper whose colour changes with each beat, cut-out objects
   with white sticker edges, and a yellow serif subtitle. Moves: spotlight circle, rubber stamp slam,
   word-by-word title, multiplying objects, decay, dotted handwriting, label pop-ins, paper stack.

Also reviewed: `github.com/yihui-dev/awesome-opus5-5-videos`, 475 prompts for code-rendered videos. It was
used as a quality bar, not as code. Ideas taken from it:
- cut-outs move "on twos" (12 fps steps) while type and camera run at 30 fps
- scenes change through an object instead of a hard cut
- a sound for every on-screen action
- write a style sheet before building

---

## 4. Story and data decisions

**The owner's direction:** story reels, not recipe videos. Halloween first. Fast-paced and shareable rather
than slow bedtime stories, which may become a later series.

**Data used:**
- **Storytelling library** in the insta-automation database, read-only:
  - `ts_*` tables: 816 saved reels, 5,441 analysed story beats, 6,814 shots, 2,302 named techniques
  - `hf_courses` / `hf_lessons`: 87 lesson notes
  - Techniques used in reel 01:
    - "Comprehension Maxxing": every voice line has its own matching visual
    - contrarian hook
    - plant one big question, then conflict → curiosity → twist
    - countdown/clock anchor
    - mirror close
    - a save prompt tied to a future moment
  - Gaps: the `views`, `shares` and `saves` columns are empty, and the set has no Halloween reels.
- **Metricool** numbers from an earlier session (126 carousels, 23 Jul to 3 Oct):
  - Halloween posts have the best share rate.
  - Sleep is the most-asked non-food topic.
  - The audience is mostly US mums aged 25–44, plus a large grandparent group.
  - The account's median reel viewer watches about 7 seconds, so reels should be 15–30s with the point
    made in the first 3 seconds.
  - The Metricool connector was later dropped ("forget about metricool").

**Halloween shortlist** (merged with ideas from another AI the owner consulted):

| Post around | Idea | Job |
|---|---|---|
| 20 Oct | 5 types of moms on Halloween night | Shares (tag a friend) |
| 26 Oct | Halloween (Sat 31 Oct) + US clock change (Sun 1 Nov): the worst week | Timely, useful, fits the sleep demand |
| 29 Oct | It's not the sugar | Comments and debate. **Built as reel 01** |
| 1 Nov | The Switch Witch in 60 seconds | Topic is popular, but every account uses the same talking-head format |
| After Halloween | The bedtime stalling loop (loop diagram) | Saves, evergreen |

**Other ideas:**
- Costume timeline (9am thrilled → 7pm half-naked)
- "Which Halloween toddler is yours?"
- Masks and the toddler brain
- Teal pumpkins (FARE's Teal Pumpkin Project; few accounts are covering it this year)
- Trick-or-treat through a toddler's eyes
- Things toddlers can do vs pretend they can't

**Rejected:**
- "Sugar → spike → crash", because sugar hyperactivity is a myth and the idea was flipped into reel 01
- "What's inside Halloween candy", because it food-shames
- Protein maths, because it is food content and the honest numbers undercut the product
- Toy history from the 1950s, because the owner felt it wasn't shareable

---

## 5. Brand decisions (for reels)

- **One brand with Tiny Soho as its face.** @tinysoho is the voice people meet on Instagram, and
  mycuratedhaven.com is where the bio link sends them.
- **Every reel ends** on the Tiny Soho heart lockup with "More at mycuratedhaven.com · link in bio".
- **Type: Fraunces** for display, italic and text, and Inter for labels. Fraunces is the closest match to
  the AI-generated slide lettering, and it is also the website's font. The `tiny-soho-motion-runtime`
  pipeline still uses Source Serif 4 and should move to Fraunces later.
- **Colours:**
  - cocoa ink `#321708`
  - rose `#B0544C`, a slightly deeper version of the brand's `#B95E56`, used on one italic emphasis word
    per line
  - cream paper `#F4EADC`
  - gold subtitles `#F3C46B` on dark paper
  - pumpkin `#E8833A` in illustrations only, never in type
  - The full list is in the style sheet.
- **Tone:** calm, realistic motherhood. No shaming of kids, parents or food, no medical advice, and
  uncertain claims say "probably".
- **US spelling** for the largest audience.

---

## 6. Reel 01: "It's Not the Sugar"

**Final file (local only):** `~/Documents/working/mch/tiny-soho-reels/out/reel01-final.mp4`
- 1080×1920, 30.1s, 30 fps
- H.264 High at about 21 Mbps, with 12-sample motion blur
- Voice, original score and 22 sound-effect cues, at −14.0 LUFS with a −1.0 dB peak

**Before posting:** the owner still needs to confirm their ElevenLabs plan allows commercial use of
generated music.

### Script (as voiced)
| # | Scene | Voice, with `eleven_v4` cues | On screen |
|---|---|---|---|
| 1 | Hook 0.0–4.1s | `[curious]` That Halloween meltdown? It's probably NOT the sugar. | "It's not the *sugar.*", readable from frame 0, with grumpy Anaika in a pumpkin costume |
| 2 | Myth 4.1–7.9s | `[matter-of-fact]` Careful studies haven't found that sugar changes kids' behavior. | Giant candy under a spotlight; SUGAR = HYPER? tag; MYTH stamp; source: JAMA 1995 meta-analysis |
| 3 | Study 7.9–13.6s | In one study, moms were told their kid had sugar. They rated them more hyper. | Clipboard; TOLD: SUGAR tag; a "parent's rating" meter slams to HYPER |
| 4 | Cup 13.6–16.3s | `[pause]` The drink? `[mischievously]` Sugar-free. | The SUGAR label peels off a party cup to show SUGAR-FREE; credit: Hoover & Milich 1994 |
| 5 | Question 16.3–18.1s | `[curious]` So… what IS it? | Curious Anaika; "So what *is* it?" |
| 6 | Reveal 18.1–23.3s | `[brisk]` The night itself. Masks. Doorbells. A bedtime two hours late. | Mask, doorbell and clock stickers pop in on their words; the clock spins from 7:42 and becomes the moon |
| 7 | Payoff 23.3–27.5s | `[warmly] [slowly]` So skip the candy guilt. Protect the bedtime. | Night; Anaika asleep in costume as Mum tucks her in |
| 8 | End 27.5–30.1s | `[softly]` Save this for Halloween night. | Tiny Soho heart lockup, URL |

**Fact base:**
- Wolraich et al., JAMA 1995: a meta-analysis of double-blind studies found no effect of sugar on behaviour.
- Hoover & Milich 1994: mothers told their son had sugar rated him more hyperactive, although every drink
  was sugar-free. The subjects were 5–7-year-old boys, so the script says "kid", not "toddler".

### Voice (ElevenLabs)
- **Voice:** the owner's cloned voice `nabel v1`, model `eleven_v4`. Each line was generated separately
  with its own direction, then joined with 0.2–0.35s gaps. Two takes were made, natural (30.1s) and tight
  (28.3s), and the owner chose **natural**.
- **How `eleven_v4` takes direction:**
  - Square-bracket audio tags placed just before the words they affect: `[curious]`, `[pause]`,
    `[whispers]`, `[slowly]`, `[warmly]`, `[softly]`, `[excited]`, `[mischievously]`.
  - CAPITALS stress a word. "…" gives a short beat; a line break gives a longer one.
  - `<break>` tags are ignored, so don't use them.
  - The official docs list a speed setting (0.7–1.2), but cues and punctuation did most of the slowing in
    testing.
  - Stability is about 0.4–0.5 for lively reads, higher for calm ones.
- **Checks:** each take was transcribed with ElevenLabs speech-to-text to confirm no cue was read aloud.
  The connector's speech-to-text only reads files under `~/Desktop`; copy the file there, then delete it.
- **Connector setup gotcha:** the Claude desktop app does not read `~/.zshrc` or `~/.zshenv`, so
  `${ELEVENLABS_API_KEY}` in `.mcp.json` arrived as literal text and gave a 401. The fix is a local-scope
  entry: `claude mcp add elevenlabs --scope local -e ELEVENLABS_API_KEY=… -- uvx elevenlabs-mcp`.

### Images (Higgsfield)
- **Used only where code can't do the job well:** the cast and print-style objects. Everything else is
  drawn in code.
- **Workspace assets:**
  - character sheets `char_anaika_v1` and `char_bhagyashree_v1`, each with a trained Soul
  - location `loc_home_apartment_v1`
- **Model:** `gpt_image_2_5` at high quality, 2k, with a transparent background, using the character
  reference elements.
- **Approximate cost per image:** 0.25 credits (low, 1k), 1 credit (medium, 2k), 2.75 credits (high, 2k).
  A video clip is about 48 credits, so motion comes from code instead.
- **Generated for reel 01 (about 19 credits in total):**
  - Anaika: grumpy pout, curious, and asleep with Mum
  - an object sheet sliced into stickers: candies, mask, doorbell, clock, moon
  - a party cup
  - a handless clock, so code-drawn hands can spin
  - kraft and night-blue paper textures
- **Safety filter:** a prompt for a wailing, kicking toddler was blocked and refunded. Keep prompts gentle
  (a pout, not distress).

### Engine: the Motion-as-Code kit
- **Source:** the owner's `Motion_as_kit.zip` and `Motion-as-Code-Workflow-Guide.pdf`, built on the
  pdoom-video engine (MIT; the licence file is kept as `LICENSE.pdoom-engine`).
- **Location:** `~/Documents/working/mch/tiny-soho-reels`. It is a local git repo with no remote; most
  reel-01 work is uncommitted.
- **What the engine does:**
  - TypeScript + three.js "plates", deterministic per frame, so the preview and the render match
  - word-level voice alignment (`analysis/align_vo.py`, wav2vec2) feeding `data/lyrics.json`
  - scenes find words with `ly.get(text)` and `wordOf(line, word)` from `app/src/scenes/_vo.ts`
  - headless Chrome render with motion blur
  - film grain, vignette and bloom
- **Changes for Tiny Soho:**
  - 1920×1080 changed to **1080×1920** in `app/src/engine/gl.ts`, `app/scripts/render.ts` and
    `app/index.html`
  - Fraunces and Inter cut into fixed weights
  - shared brand toolkit `app/src/scenes/_brand.ts`: palette, paper, rich text with the rose italic,
    gold subtitles, the lockup and stickers
  - eight new scenes: `hook`, `myth`, `study`, `cup`, `question`, `reveal`, `payoff`, `end`
  - `analysis/mix_reel.py`, which rebuilds the sound mix from cue times without re-rendering the picture
- **Needs:** `bun` (installed, 1.4.2), `uv`, ffmpeg, Chrome. The final render took about 3 minutes on the
  Mac, which has a GPU.
- **Object transitions:**
  - Hook → Myth: a candy flies to centre and becomes the spotlit candy.
  - Myth → Study: a push into the stamp's paper.
  - Study → Cup: the meter needle points at the cup.
  - Cup → Question: the label flips the frame.
  - Question → Reveal: an iris into night.
  - Reveal → Payoff: the clock becomes the moon.
  - Payoff → End: a blanket-fold wipe.

### Sound
- **Score:** an original 30.1s bed from ElevenLabs Music in six sections timed to the scenes, starting with
  plucked strings and celesta and ending in a music-box lullaby.
  - Music chunks must be at least 3,000 ms.
  - `force_instrumental` only works with a plain prompt, not a composition plan.
  - Speech-to-text found no vocals.
- **Effects:** 15 original effects placed as 22 cues on the word timings: thump on "NOT", candy burst on
  "sugar.", stamp, strike, clipboard slide, needle boing, label peel, card flip, pops, clock spin, moon
  twinkle, blanket swish, end ding.
- **Mix:** music about 9 dB under everything, ducked a further 7 dB under the voice; master at −14 LUFS.

### Gotchas hit during the build
- A red cast came from the kit's old opening plate overlapping on the timeline. The reel now has its own
  timeline.
- A fade bug in `_brand.ts` showed lines before they were spoken. The fix multiplies `globalAlpha`.
- The trim step deleted a near-silent sound effect. The pipeline now keeps originals.
- zsh doesn't word-split variables and numbers its arrays from 1, which broke scripts twice. Pass explicit
  arguments.
- `preview-0-13.mp4` was overwritten by a re-render. Give every render its own versioned name.

---

## 7. Tiny Soho Studio: the Reels section (this repo)

### Where Claude Code runs (decided)
- **Options considered:**
  - (A) a cloud Claude Code routine, which is how the carousel **motion director** already works: the site
    fires `TINY_SOHO_ROUTINE_FIRE_URL` and a session runs from `tiny-soho-motion-runtime`
  - (B) a runner on the owner's Mac
  - (C) the Railway creative worker with the Claude API
- **Chosen: B, the Studio Mac runner.** Quality is the same anywhere, because the reel is code. The Mac
  renders WebGL natively and fast, and rendering, re-renders and remixes cost nothing. Claude usage is
  the same on Mac or cloud, so the saving comes from calling Claude **only for thinking steps** (idea,
  script, scene code, fixes). Everything mechanical runs as plain scripts.
- **Creators never need Claude credentials.** They sign into the website; the runner uses the owner's
  login. A personal Claude subscription is probably not meant to power a multi-user tool (check
  Anthropic's terms), so when creators join, switch the runner to an Anthropic API key. The runner
  records `claude_auth` as `subscription` or `api_key`.
- **The Mac must be on, awake and online.** A closed lid ("Clamshell Sleep") stops it; jobs wait in the
  queue and the UI says "Waiting for the Studio Mac".

### What shipped
| PR | Merge commit | What |
|---|---|---|
| [#74](https://github.com/Pratikn07/tiny-soho-motion-studio/pull/74) | `cbda833` | App shell: top bar with Reels, Carousels, Library, Creations, the Studio Mac status chip, "Old studio" and Sign out. Carousels holds the existing creation page unchanged. Flag `TINY_SOHO_STUDIO_SHELL` |
| [#75](https://github.com/Pratikn07/tiny-soho-motion-studio/pull/75) | `9cbdd12` | Migration `20261006000000_reels.sql`, runner API routes, `runner/` program and launchd agent; the chip shows real runner status |
| [#76](https://github.com/Pratikn07/tiny-soho-motion-studio/pull/76) | `8127a60` | Reels screens: reel list and "Start a reel", 8-step rail, working Idea and Script steps, reel API routes |

- Production is at `https://tiny-soho-creative-studio.vercel.app`, deployed from `8127a60`.
- Railway was not redeployed, because nothing in `creative-worker`, `creative-vision` or `services`
  changed.

### Data model (`supabase/migrations/20261006000000_reels.sql`, applied)
- **`creative_studio_reels`:**
  - `title`, `status`: `draft`, `in_progress`, `ready` or `archived`
  - `current_step`: one of `idea`, `script`, `storyboard`, `voice`, `images`, `build`, `sound`, `export`
  - `document` (jsonb): the reel's working document (`topic`, `idea`, `script{lines, notes, approved}`)
  - `revision`
- **`creative_studio_reel_jobs`:**
  - `step`, `kind`: `draft`, `revise`, `render` or `mix`
  - `status`: `queued`, `running`, `needs_review`, `completed`, `failed` or `canceled`
  - `input` / `result` (jsonb), `runner_id`, `progress`, `error_code`
  - a lease (`worker_lease_id`, `worker_lease_expires_at`), and `unique (reel_id, idempotency_key)`
- **`creative_studio_runners`:** `id` (text), `label`, `claude_auth`, `version`, `last_seen_at`.
- **`claim_creative_studio_reel_job(runner)`:** security definer, uses `for update skip locked`, gives a
  two-minute lease, and is executable only by `service_role`.
- **Access:** RLS is on with no policies, the same as every `creative_studio_*` table, so only the hosted
  API (service role) can read or write. Default anon/authenticated grants exist but RLS blocks them.
  Revoking them is optional hardening.
- A schema-only backup from before the push is kept outside the repo.

### Code map
- **Shell:** `hosted/components/shell/`
  - `sections.ts`: the four sections; the default is `carousels`; the section is kept in the URL hash, for
    example `#reels`
  - `ShellBar.tsx`: the bar and the `StudioMacChip` popover; `MacState` is `not-set-up`, `online` or
    `asleep`
  - `AppShell.tsx`: renders Carousels through a `carousels(bar)` render prop, and Reels through
    `ReelsStudio`
  - `useRunnerStatus.ts`: polls `/api/runner/status` every 30s
  - `CreationShell.tsx` gained an optional `topbar` prop so the shell bar replaces its header
- **Entry and flags:** `hosted/components/creation/StudioEntry.tsx`, `hosted/components/HostedStudio.tsx`,
  `hosted/lib/env.ts` (`studioShellEnabled`), `hosted/app/page.tsx`.
- **Runner server side:** `hosted/lib/runner.ts`
  - the token must be at least 32 characters and is compared as a sha256 with `timingSafeEqual`
  - the runner counts as online if seen within 90s
  - `RunnerRepository` handles heartbeat, claim, updateJob and status. Updates must match the lease;
    `running` renews it by two minutes and a final status clears it
- **Runner routes:** `hosted/app/api/runner/{heartbeat,claim,jobs/[id],status}/route.ts`. Status uses
  owner auth; the others use the runner bearer token.
- **Reels server side:** `hosted/lib/reels.ts`
  - zod schemas
  - `ReelsRepository`: `list`, `create` (queues `idea/draft`), `get` (newest job per step), `act`, and
    `absorb`, which folds a `needs_review` script result into the reel document when the reel is read, so
    the runner never writes the document
  - actions: `choose_idea`, `revise_script`, `approve_script`, `retry`
- **Reels routes:** `hosted/app/api/reels/route.ts` (GET, POST), `[id]/route.ts` (GET),
  `[id]/actions/route.ts` (POST). All use owner auth.
- **Reels UI:** `hosted/components/reels/`
  - `ReelsStudio.tsx`: home, the 8-step workspace, JobState (Queued / Waiting for the Studio Mac /
    Working / Failed + Try again), IdeaStep and ScriptStep; it polls every 4s while a job is active
  - `api.ts`
  - `mock-api.ts`: a sample stand-in used in mock mode
  - `reels.module.css`
- **Runner program:** `runner/`
  - `runner.mjs`: dependency-free Node; reads `~/.config/tiny-soho/runner.env`; heartbeat every 20s, claim
    poll every 10s, lease renewal every 45s
  - `handlers.mjs`: `askClaude` runs `claude -p <prompt> --output-format json --max-turns 1
    --allowedTools ""` in a temp directory. Handlers exist for `idea/draft` (three ideas as JSON) and
    `script/draft` and `script/revise` (with `SCRIPT_RULES` taken from reel 01). Other steps throw
    `step_not_ready`
  - `install.sh` and `com.tinysoho.runner.plist`: launchd agent
  - `README.md`, `runner.env.example`
- **Tests:** `hosted/tests/app-sections-shell.test.tsx` (6), `runner.test.ts` (8), `reels.test.tsx` (6,
  including the full Idea → Script → Approve flow). The suite had 367 passing at #76.

### Running and operating
- **Sample mode, no sign-in:** `npm --prefix hosted run dev`, then open
  `/?studio=creation&mock=1&shell=1#reels`.
- **Flags:**
  - `TINY_SOHO_STUDIO_SHELL=true` in Vercel production makes the shell the default
  - `?shell=1` / `?shell=0` turns it on or off for one visit
  - `?studio=legacy` opens the old studio
  - `TINY_SOHO_CREATIONS_V2` is also on
- **Vercel production variables added:** `TINY_SOHO_STUDIO_SHELL`, `TINY_SOHO_RUNNER_TOKEN`,
  `TINY_SOHO_RUNNER_OWNER_ID`. The last two are sensitive; never print them.
- **Deploy `hosted/` to production:**
  1. `git archive origin/main hosted` into a temp directory.
  2. Copy `hosted/.vercel/project.json` into it.
  3. Run `vercel deploy --prod --yes --meta gitCommitSha=<sha>` with the owner's dedicated Vercel CLI
     config.
  4. Check health, and that `/api/reels` and `/api/runner/*` return 401 without auth.
- **Update the installed runner after `runner/` changes:**
  1. `git archive origin/main runner | tar -x -C ~/.local/share/tiny-soho`
  2. `launchctl kickstart -k gui/$(id -u)/com.tinysoho.runner`
  3. Check `~/Library/Logs/tiny-soho-runner.log`.

---

## 8. Next steps (agreed order)

1. **Real production test** of Idea → Script. The owner is doing this; it creates rows in the shared DB.
2. **Storyboard step:** one still per scene for approval.
3. **Voice step:** server-side ElevenLabs (`nabel v1`, `eleven_v4`), two takes, then word alignment.
   Spending counts against the existing monthly budget cap (`hosted/lib/budget.ts`).
4. **Images step:** server-side Higgsfield, only what the story needs, with the cost shown before
   generating.
5. **Build step:** Claude Code writes scenes in the motion engine. The engine needs to live somewhere the
   runner can reach; it is currently local-only in `tiny-soho-reels`. The step sends back stills and a
   preview, and the owner comments.
6. **Sound and Export steps:** score, effects, mix at −14 LUFS; the final 9:16 file, cover frame and
   caption.
7. **Library and Creations sections:**
   - Library: cast, brand kit, voice, music, the storytelling library
   - Creations: reels and carousels together
   - Both are placeholders today.
8. **Optional:** revoke default anon/authenticated grants on the three reel tables. This needs DB approval.

---

## 9. Open proposals (discussed, not decided or built)

### Move the runner off the Mac
- **Railway** can host the thinking steps. It is always on, so there are no lid problems. It needs Claude
  Code in the container and a login: the owner's subscription via `claude setup-token` for now, an API key
  once creators join. Railway variables are set by the owner in the dashboard.
- **Railway has no GPU,** so the 900-frame WebGL render would be slow there.
- **Proposed split:**
  - Each runner declares which steps it claims: one filter added to the claim function and runner config.
  - Railway takes `idea`, `script` and `storyboard`.
  - A GPU machine takes `build`, `render` and `mix`: the Mac for now, or Modal (the owner already runs
    `tiny-soho-ltx` there) once WebGL is verified.
- **Alternatives:**
  - call the Claude API directly from Vercel or the worker for single-turn text steps (no Claude Code
    needed)
  - a Mac mini as an always-on runner
  - cloud routines for heavy agentic work
  - GitHub Actions for occasional renders (no GPU)
- **Decision needed from the owner:** Railway with Claude Code and the subscription token, or direct API
  calls for the text steps.

### Brainstorm chat with uploads (replaces the one-shot topic box)
The owner wants step 01 to become a back-and-forth chat. They can upload a video or images, discuss the
niche and angle, and click **Write the script** when ready.
- **Two upload intents, and Claude should ask which one:**
  - **Reference** ("make something like this"): Claude breaks down the hook, pacing, text style and why it
    works, then adapts it to parenting and Tiny Soho.
  - **Own footage** ("use this clip"): Claude lists what's in it with timestamps and suggests where it
    fits. This needs Build-step support for real footage, so it comes later.
- **How Claude watches video:** the runner extracts stills (about 1 fps plus each cut) and transcribes the
  audio, then Claude reads both together.
- **Brief panel:** Claude keeps a short brief up to date (angle, hook candidates, references, feel) next
  to the chat. The script step starts from it. "Give me 3 ideas" stays as a suggestion chip.
- **Uploads:**
  - Browsers upload straight to a private Supabase Storage bucket, because Vercel's request limit is
    4.5 MB.
  - A new bucket or migration needs DB approval.
  - Suggested cap: about 200 MB / 3 min.
  - Clips may show children: keep them private, never send them to other services without consent, and
    give each upload a delete button.
- **Latency:** each chat reply through the Mac queue takes an estimated 15–35s (10s claim poll + 4s UI
  poll + 5–15s for Claude). Fixes:
  - instant pickup and one continuing Claude session per reel, estimated at about 8–15s
  - chat via the Claude API from Vercel with streaming, about 2–5s to first words, billed per message.
    Video analysis would stay on the runner
- **Grounding:** the storytelling library, the style sheet and the no-recipe rule.
- **Suggested order:**
  1. text chat + brief + Write the script
  2. reference-video upload and breakdown
  3. own footage in the reel
- **Decisions needed:** chat via the Mac or the API, and how soon own footage matters.

---

## 10. Local-only paths (not on GitHub)

| Path | What |
|---|---|
| `~/Documents/working/mch/tiny-soho-reels/` | Motion engine, reel-01 scenes, audio, Higgsfield images (`app/public/hf/`), outputs (`out/`), `STYLE.md` |
| `~/Documents/working/mch/tiny-soho-motion-runtime/` | Carousel motion-director routine repo; brand fonts and logo in `brand/` |
| `~/Documents/working/mch/insta-automation/` | App sharing the Supabase project; `ts_*` storytelling tables |
| `~/.local/share/tiny-soho/runner/` | Installed runner (copied from `runner/`) |
| `~/.config/tiny-soho/runner.env` | Runner secret and settings (mode 600, never print) |
| `~/Library/Logs/tiny-soho-runner.log` | Runner log |
| Worktrees `tiny-soho-shell`, `tiny-soho-runner`, `tiny-soho-reels-ui` | Branches for #74, #75, #76 (merged) |
