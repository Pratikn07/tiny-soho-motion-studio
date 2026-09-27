# Hosted Creative Suite release boundary

This is the release checklist for the hosted Tiny Soho Creative Suite branch.
It applies only to `creative_studio_*` Supabase objects, the private
`creative-studio` bucket, the existing Tiny Soho Creative Worker, a new
isolated `creative-vision` Railway service, and the hosted Vercel app. It does
not authorize a change to Instagram automation.

## Required configuration

| Runtime | Required values | Must not receive |
| --- | --- | --- |
| Vercel hosted app | Existing Supabase URL, publishable key, service-role key, and owner-email allowlist | Alibaba, Meta, Instagram, or Vision-worker credentials |
| Existing Creative Worker | Existing Supabase URL/service role, Singapore `DASHSCOPE_API_KEY`, `ALIBABA_WORKSPACE_ID`; optional `CREATIVE_DIRECTOR_MODEL` | Meta or Instagram credentials |
| New `creative-vision` Railway service | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `CREATIVE_VISION_POLL_SECONDS` | Alibaba, Meta, Instagram, OCR/SAM/Qwen runtime keys, model weights |

The browser receives only the Supabase publishable key. The service-role key is
server-only and must never be added to browser code, source control, logs, or
chat.

## Ordered release

1. Deploy the migration `20260921012509_hosted_creative_suite.sql` to the
   existing Tiny Soho Supabase project. Confirm all new tables have RLS enabled
   and all four claim/approval functions grant only `service_role`.
2. Deploy the current Creative Worker from this release SHA in the existing
   isolated Creative Worker service. Confirm its health route before allowing
   any queue item.
3. Create `creative-vision` in the existing isolated Tiny Soho Creative
   Railway project, using `creative-vision/Dockerfile`. Give it only the two
   Supabase values above. Confirm `GET /health` and the `creative_studio_vision_capabilities`
   rows before using Vision from the browser.
4. Deploy `hosted/` from the same SHA to Vercel. Do not add Alibaba credentials
   to Vercel. Confirm the owner sign-in and the Motion & Assets, Creative
   Director, Workflows, and Vision Lab navigation.
5. Run non-billable owner smoke checks: save a valid workflow without starting
   it, inspect the Vision capability table, and optionally process a harmless
   CPU-safe overlay only after the Vision service health is verified.

## Provider boundary

Creating a Director draft causes the worker to call Qwen after it claims the
request. Approving a Director proposal or running a video workflow can submit
Alibaba video work. Neither belongs in a deployment smoke test. Run either
only after the owner confirms quota/billing and asks for that provider check.

## Rollback

Roll back Vercel, the Creative Worker, and `creative-vision` independently to
their previous image/deployment. Do not drop the new tables or bucket objects
as a rollback shortcut; preserve queued records and inspect them before any
manual recovery. Instagram automation remains untouched throughout.
