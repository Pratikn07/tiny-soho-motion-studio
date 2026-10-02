# Hosted Creative Suite release boundary

This checklist covers the hosted owner-only Tiny Soho creation release (O2). It applies only to the
existing private `creative-studio` bucket and `creative_studio_*` objects, the isolated Tiny Soho Railway
project, Modal app `tiny-soho-ltx`, and the hosted Vercel application. Instagram automation is outside this release.

## Required configuration

| Runtime | Required values | Must not receive |
| --- | --- | --- |
| Hosted Vercel app | Existing Supabase URL, publishable key, service-role key, owner-email allowlist; `TINY_SOHO_CREATIONS_V2=true`; production motion reviewer `REVIEW_PROVIDER=gemini`, `REVIEW_MODEL=gemini-3.5-flash-lite`, server-only `GEMINI_API_KEY`; optional worker billing URL | Modal, Alibaba, Meta or Instagram credentials |
| Creative Worker | Existing Supabase URL/service role, Singapore `DASHSCOPE_API_KEY`, `ALIBABA_WORKSPACE_ID`; `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` for LTX | Meta or Instagram credentials |
| creative-vision | Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `CREATIVE_VISION_POLL_SECONDS` | Modal, Alibaba, Meta, Instagram, OCR/SAM/Qwen runtime keys or GPU model weights |
| Modal deployment | Existing Modal account authentication; `LTX_ALLOWED_URL_HOSTS` limited to the existing Supabase storage host and `LTX_MAX_CONTAINERS=1` at deploy time | Supabase service-role key, Meta or Instagram credentials |

The owner adds the Modal worker variables in Railway Production Variables and confirms them before
worker deployment. Do not set these variables from the CLI. Never put credentials in a shell command,
PR, source file or log. Preserve Alibaba configuration.
Only the Supabase publishable key and URL are public. `TINY_SOHO_CREATIONS_V2` remains server-side;
the home page receives only its boolean. Both studios still enforce the owner authorization check.

## Ordered release

Use a clean export of merged `main`. Railway currently has no repository source configured, so
`railway redeploy` alone would reuse its prior uploaded image. Upload the required source with `railway up`
and record the deployment ID and source SHA. Verify every step before starting the next.

0. Confirm the existing creation-v2 schema prerequisite. Do not reapply migrations as part of a service redeploy.
   Any missing migration needs the owner's explicit database approval under `CLAUDE.md`.
1. Deploy **creative-vision** with `creative-vision/Dockerfile` and its Railway configuration.
   Verify a successful deployment, `GET /health` returning configured=true, deployed source hashes matching main,
   and fresh `finish` and `check` capability heartbeats. This service finishes generated backgrounds and checks takes.
2. After **P2 #43 is merged**, deploy **tiny-soho-ltx from that merged main**, using
   `modal deploy providers/modal-ltx/app.py` with the allowed storage host and one-container limit.
   The prior live app was deployed from P2's branch; it is not a main-source release receipt.
   Verify the deployment, zero tasks/containers before use, and the configured input restrictions.
   Deployment itself must not start a GPU generation call.
3. Only after Modal passes, have the owner add **MODAL_TOKEN_ID and MODAL_TOKEN_SECRET** to the existing
   **creative-worker** Railway Production Variables, then obtain approval and upload the worker from main.
   Preserve its Alibaba and Supabase values. Verify successful deployment, health, deployed source hashes,
   pipeline availability and the registered Modal/Alibaba providers. Variable presence alone is not a generation test.
4. After owner approval, configure **TINY_SOHO_CREATIONS_V2=true** in Production and deploy **hosted/**
   to its existing Vercel project. The current CLI upload uses `hosted/` as its standalone source and project
   Root Directory `.`. Its `.vercelignore` excludes repository mirror tests and local artifacts; full-repository
   CI still runs and typechecks the tests with their sibling worker source available. Verify the served source SHA, owner login,
   creation at `/`, **Tools → Old studio**, and owner access to `/?studio=legacy`.
   With the flag off, `/` retains its existing default and `/?studio=creation` remains the testing entry point.
   Check browser bundles for server credentials before declaring activation complete.
5. Run the creator's real ten-slide production gate. Record acceptance within two retries (target eight of ten),
   text pixel exactness, visible/capped spend, upload-to-download time and usability issues.
   Health checks, capability heartbeats, uploaded benchmark clips and green CI do not replace this gate.
   GPU generation requires an explicit bounded test budget; do not silently repeat the prior paid batch.

## Release receipts — 1 October 2026

| Step | Verified state |
| --- | --- |
| U3 | #58 merged as `0374fdd5a109a925c47a33f4f94b9769d8aef331`; its live gate moved to O2 by owner decision |
| creative-vision | Deployment `67805e9f-14cc-4975-9585-76559c4640b5`, clean main export `0374fdd`, SUCCESS; health 200/configured=true; main.py, processor.py, finish.py and checks.py hashes match; fresh finish/check heartbeats available at service version 0.2.0 |
| P2 / Modal | #61 integrated and #43 merged as `a382916112e4880c2608fd96c7318b1e92760755`. Four benchmark outputs succeeded; official billing confirmed $0.35314708 total, below $0.50. Clean main deploy reported identical live code/config and made no revision; approved rolling rollover recorded v2 at 08:46:22 PDT. History retains `b9dfab9` for unchanged code, accepted by the owner. App `ap-hCdBUSc4pxGdQN0kSpzKai` deployed, tasks 0 and containers empty at verification; no new GPU generation |
| Storage preflight | Read-only `storage.info()` on a missing object in the live bucket returned `StorageApiError`, HTTP status 400 and `statusCode: "404"`, matching #61's not-found handling |
| creative-worker | Owner added both Modal variables and approved deployment from `a382916`. Deployment `808c9627-4d80-47cb-9276-67327cae2db8`, SUCCESS; health 200/configured=true; eight deployed runtime/package hashes match. Startup log registers `modal-ltx, alibaba`. Through 18:07:03 UTC, zero new needs_attention jobs/events, storage-check-failed jobs/log lines, or provider_submit_failed jobs. No variable writes or generation started by the release agent |
| Hosted activation | Upload repair #62 merged as `f1c121a87c3f4c6ba94321a31e14a1cbf6d65bb3`, application source identical to `a382916`. Deployment `dpl_8j4vRP9r77gDgPuBUkk6TUrrDrS1`, READY, production alias [tiny-soho-creative-studio.vercel.app](https://tiny-soho-creative-studio.vercel.app). Server-only flag enabled; health 200/configured=true; root receives creationsV2Enabled=true. Projects API rejects unauthenticated requests with 401. Chrome shows the sign-in gate at root, legacy and production mock URLs |
| Browser credential scan | Eight fetched public JavaScript assets: zero matches for the known local NVIDIA key, production worker Supabase service-role key, or NVIDIA/Supabase server-key formats; positive controls pass. Vercel Secrets are write-only, so an exact comparison against their current stored values is unavailable and is not claimed |
| Creator gate at initial activation | At this 1 October snapshot the browser was signed out and the first production take had not run. Superseded by the dated Gemini, progress and first-take evidence below; the ten-slide gate remains open |

The separate CLI profile `/Users/pratik.nandoskar/.config/vercel-tiny-soho` is authenticated to
`pratiknandoskar07-6729` with scope `pratiknandoskar07-6729s-projects`. The existing project remains
`prj_EPja5S0FAAMEACQGC773bNvb3710` in `team_6emrdjNzEAUhyhDMJjrwcCxy`; no replacement project was created.
The first #62 CI attempt timed out while Ubuntu downloaded FFmpeg dependencies; the unchanged retry passed.

## Subsequent releases and production acceptance — verified 2 October 2026

These receipts extend the initial activation; they do not imply that every service was redeployed from the latest hosted commit.

| Step | Evidence and limits |
| --- | --- |
| Merged task status | GitHub confirms #43 merged as `a382916112e4880c2608fd96c7318b1e92760755` and #58 as `0374fdd5a109a925c47a33f4f94b9769d8aef331`. The former draft holds are superseded; U3's real creator gate remains with O2 |
| Gemini motion review | #65 merged as `fd51136fd16ef89ce9154bf607933b87aad328c2`; release verification recorded Vercel `dpl_Edug6o57Nxv3HNqC2mNmKTUWoP1p` Ready from that commit. Authenticated UI returned three suggestions, checked a custom idea, exercised Calm/Lively controls and retained saved choices after reload. Completed review records identify `gemini` / `gemini-3.5-flash-lite`. This verifies runtime requests, not the four-design reviewer quality benchmark |
| Per-take progress | #66 merged as `4b90fb2f31a6781671531b0a21dc176ebc25370f`; release verification recorded `dpl_DsCC7gapqZRQbsPorfFJZn1Jgu4a` Ready with matching main-commit metadata and the production alias. Signed-in creation page and new progress CSS loaded. Desktop/mobile sample previews and regression tests covered active, completed, rejected and canceled states without a generation call |
| Current health | On 2 October, production `/api/health` returned HTTP 200 with `ok=true`, `configured=true`. Deployment IDs and source hashes above are release-time receipts; a fresh deployment-metadata read during this documentation update returned HTTP 403 and is not claimed as successful |
| First real creator take | The owner started run `c17c7841-3982-4c16-8410-a991f4989c2e` on 2 October at 13:24:02 PDT; it completed at 13:28:40 PDT, about 4m 37s from run creation through final checks. LTX's first take was `done` / `accepted`, with no run/job error. Job events contain `submitted`, `running`, `downloading`, `completed`. Raw video, finished video and cover objects were verified in the private bucket. The job and spend ledger record 59.1 GPU seconds and $0.0498; these are per-job records, not total Modal billing |
| Remaining creator acceptance | Only one production slide/run is proven. No `chosenTakeId` was saved at the 2 October read-only check. Selection, downloaded-video visual acceptance, mid-run close/reopen recovery, bulk preview/downloads and the real ten-slide target remain unverified. Automatic acceptance is not a substitute for the creator checking text and motion visually |

## Remaining O2 checklist

- Complete the real ten-slide workflow without help, including upload, motion review, progress, comparison, selection and downloads; at least eight of ten slides accepted within two retries.
- Record real mid-run close/reopen recovery, final text fidelity and upload-to-download time. The 4m 37s receipt above starts at run creation and excludes upload/review/download time.
- Verify visible spend against the ledger and perform a bounded cap-refusal test without crossing the cap. Existing local SQL tests are not a live provider/staging test. Reconcile per-job ledger costs with Modal workspace billing, including startup and idle overhead.
- Record the publication checklist's AI-disclosure/licence and provider-data-terms review. Neither this receipt nor a completed run proves those reviews or that Instagram's AI label has been enabled.
- Keep legacy removal as a separate PR after two weeks of successful use. Do not mark O2 or G7 complete based on the single-slide test.

P1's four-design reviewer quality benchmark and P3's real Wan finishing/checks benchmark also retain their own unverified acceptance gates; they are not silently satisfied by the LTX test.

## Rollback

Record the prior deployments before changing each service. The previous creative-vision deployment is
`2c82f788-a900-4edf-8e65-e7a709a1268d`; prior worker `e27ad5da-8efb-4cf1-8b01-07f08eefbfa1`,
and prior hosted deployment `dpl_AiR7juyVPz35nXqEA6aXuRx4eTUG`
(`tiny-soho-creative-studio-hn1lyxwxb.vercel.app`). Roll back service images independently,
and set the hosted flag to false plus redeploy to restore the old home. Retain the Old studio entry during rollout.
Do not drop tables, delete bucket objects or alter queued records as a rollback shortcut.

Legacy compositor/region-editor removal remains a separate PR after two weeks of successful use.
