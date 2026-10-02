# Tiny Soho Studio (hosted)

This is a standalone, owner-only Vercel application using Node.js `24.x`. The existing production project receives CLI uploads of this directory with project Root Directory `.`. For a Git integration that uploads the entire repository, use `hosted` as Root Directory.

`.vercelignore` excludes repository mirror tests (which import sibling worker source), local environment files, and generated artifacts from standalone uploads. Repository CI still runs and typechecks the tests.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TINY_SOHO_STUDIO_ADMIN_EMAILS`

Creation motion review is explicitly selected with server-only `REVIEW_PROVIDER` and `REVIEW_MODEL`. Production currently uses `REVIEW_PROVIDER=gemini` and `REVIEW_MODEL=gemini-3.5-flash-lite`, with `GEMINI_API_KEY` stored as a server secret. The same reviewer handles suggestions and creator-idea checks; Gemini requires an explicit model. See [.env.example](.env.example) for configuration without secret values.

The legacy NVIDIA analysis path uses `NVIDIA_API_KEY` and `NVIDIA_VISION_MODEL`. Creating a key or passing health checks does not prove a provider request succeeds. Gemini suggestions and creator-idea checks have been verified in the authenticated production UI; the four-design quality benchmark remains outstanding.

## Creation release flag

`TINY_SOHO_CREATIONS_V2=true` makes the creation flow the home screen at `/`.
It is a server-only setting and defaults to off; unset, `false`, or an invalid value retains the old home.
Both flows require the existing Supabase sign-in and owner allowlist check. The server passes only the
flag's boolean to the browser, and reads it per request rather than freezing it into a static home page.

The creator can open **Tools → Old studio** (`/?studio=legacy`) while the flag is on.
`/?studio=creation` remains available for owner testing while it is off. Sample-data mode
(`/?studio=creation&mock=1`) works only in development and is never an authorization bypass in production.

Enable the flag in the existing hosted Vercel project's Production environment only after the ordered
backend deployment and verification in [the release checklist](../docs/architecture/hosted-creative-suite-release.md).
Redeploy the hosted app after a Vercel environment change. Set the flag to `false` and redeploy for a UI rollback.

Only the two `NEXT_PUBLIC_` variables are exposed in the browser. All other values stay server-side. The `creative-studio` Supabase Storage bucket is private; the app creates short-lived signed URLs only after server-side owner checks.

`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `DASHSCOPE_API_KEY` and `ALIBABA_WORKSPACE_ID` belong only to the separately deployed Creative Worker. They must not be configured in Vercel.

Production was activated on 1 October 2026. Subsequent releases added Gemini (#65, `fd51136`) and per-take progress (#66, `4b90fb2`). The #66 release verified deployment `dpl_DsCC7gapqZRQbsPorfFJZn1Jgu4a` as Ready at [tiny-soho-creative-studio.vercel.app](https://tiny-soho-creative-studio.vercel.app). Production health was checked again on 2 October, and the owner's first real LTX take completed and was accepted. The ten-slide creator acceptance gate remains open. See the release checklist for dated receipts, exact evidence limits and rollback.

## Creation workflow and progress

Upload a background and transparent text layer per slide, choose a suggested or checked custom motion, then generate using LTX by default or an explicitly selected alternative. Creative Worker drives generation; creative-vision finishes the video and checks it. Under **Takes and downloads**, each take follows **Animate → Add text → Check**, with processed/ready counts, elapsed time and recorded cost. While a run is active, the UI polls its saved status about every four seconds, pauses when the page is hidden, and refreshes on return. The display does not estimate a percentage. Accepted takes can be chosen for carousel preview and downloads.

The 2 October production verification found one accepted take with raw, final and cover files in storage, 59.1 GPU seconds and $0.0498 recorded spend. A saved choice, downloaded-video visual acceptance, close/reopen recovery during a real run and the full ten-slide flow remain unverified.

## Modal workspace billing

Set server-only `CREATIVE_WORKER_BILLING_URL` to the creative-worker HTTPS origin after deploying the worker's billing endpoint. The owner-only budget route signs read requests with the existing shared `SUPABASE_SERVICE_ROLE_KEY`; neither that key nor Modal tokens are sent to the browser. Modal tokens stay in the worker's Railway Variables.

The budget popover displays the current UTC billing month's reported usage before credits, credits applied, billed amount, and last successful update. This includes the whole Modal workspace, including activity outside Tiny Soho. The $50 studio cap, spend ledger and reservations remain independent. Free-storage and other non-credit adjustments are already reflected in the displayed usage; raw metered cost would overstate it.

Modal's summary API does not report a remaining credit balance. The popover links to Modal's Usage & Billing settings for the exact balance rather than estimating it. Reads are cached for one minute in the worker; the page refreshes every 30 seconds and on focus. Failed refreshes show retained values as stale; values never carry into a new billing month. If the endpoint is unconfigured or unavailable, the studio budget remains usable and Modal is labeled unavailable. Provider collection delays can still apply.

## Local commands

```bash
cd hosted
npm install
npm test
npm run check
npm run build
```

## Scope boundary

This app provides the creation and legacy Studio interfaces, owner-gated API routes, and job-status reads. The separate Creative Worker routes generation to configured providers; creative-vision handles CPU finishing and checks. This Vercel app does not run Instagram automation, Meta webhooks, Railway workers, a permanent provider worker, or any scheduled job.
