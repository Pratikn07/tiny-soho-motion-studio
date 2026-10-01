# Tiny Soho Studio (hosted)

This is a standalone, owner-only Vercel application using Node.js `24.x`. The existing production project receives CLI uploads of this directory with project Root Directory `.`. For a Git integration that uploads the entire repository, use `hosted` as Root Directory.

`.vercelignore` excludes repository mirror tests (which import sibling worker source), local environment files, and generated artifacts from standalone uploads. Repository CI still runs and typechecks the tests.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TINY_SOHO_STUDIO_ADMIN_EMAILS`

Server-side vision analysis also uses `NVIDIA_API_KEY` and `NVIDIA_VISION_MODEL`. These are already configured in the existing production project; health configuration alone does not prove a provider request succeeded.

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

Production activation on 1 October 2026: deployment `dpl_8j4vRP9r77gDgPuBUkk6TUrrDrS1` from main `f1c121a` is Ready at [tiny-soho-creative-studio.vercel.app](https://tiny-soho-creative-studio.vercel.app), with the creation flag enabled. Health and signed-out authorization checks passed; authenticated creator acceptance remains pending. See the release checklist for receipts and rollback.

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
