# Hosted Creative Suite release boundary

This checklist covers the hosted owner-only Tiny Soho creation release (O2). It applies only to the
existing private `creative-studio` bucket and `creative_studio_*` objects, the isolated Tiny Soho Railway
project, Modal app `tiny-soho-ltx`, and the hosted Vercel application. Instagram automation is outside this release.

## Required configuration

| Runtime | Required values | Must not receive |
| --- | --- | --- |
| Hosted Vercel app | Existing Supabase URL, publishable key, service-role key, owner-email allowlist; `TINY_SOHO_CREATIONS_V2=true` to activate the new home | Modal, Alibaba, Meta or Instagram credentials |
| Creative Worker | Existing Supabase URL/service role, Singapore `DASHSCOPE_API_KEY`, `ALIBABA_WORKSPACE_ID`; `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` for LTX | Meta or Instagram credentials |
| creative-vision | Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `CREATIVE_VISION_POLL_SECONDS` | Modal, Alibaba, Meta, Instagram, OCR/SAM/Qwen runtime keys or GPU model weights |
| Modal deployment | Existing Modal account authentication; `LTX_ALLOWED_URL_HOSTS` limited to the existing Supabase storage host and `LTX_MAX_CONTAINERS=1` at deploy time | Supabase service-role key, Meta or Instagram credentials |

Use the existing secure local configuration to supply the Modal worker variables through stdin;
never put credentials in a shell command, PR, source file or log. Preserve Alibaba configuration.
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
3. Only after Modal passes, add **MODAL_TOKEN_ID and MODAL_TOKEN_SECRET** to the existing **creative-worker**
   Railway service using `--stdin --skip-deploys`, then upload/redeploy the worker from main.
   Preserve its Alibaba and Supabase values. Verify successful deployment, health, deployed source hashes,
   pipeline availability and the registered Modal/Alibaba providers. Variable presence alone is not a generation test.
4. Deploy **hosted/** to its existing Vercel project with the new flag code, then activate
   **TINY_SOHO_CREATIONS_V2=true** in Production and redeploy. Verify the served source SHA, owner login,
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
| P2 / Modal | #43 remains draft at `de86c98` with green CI. Four benchmark outputs succeeded and Modal billing confirms $0.35314708 total, below $0.50. Its new runtime recovery guard still needs fail-closed handling of storage inspection errors before merge. Main-source redeploy pending |
| creative-worker | Pending Modal step. Existing worker deployment `e27ad5da-8efb-4cf1-8b01-07f08eefbfa1`; both Modal variables were absent at preflight |
| Hosted activation | Flag implementation and local verification completed; production activation pending the backend sequence and access to the existing Vercel project |
| Creator gate | Not run; no ten-slide production acceptance claim |

The current Vercel CLI account only exposes `my-curated-haven-web`; the local Tiny Soho project link
points to `prj_EPja5S0FAAMEACQGC773bNvb3710` in inaccessible `team_6emrdjNzEAUhyhDMJjrwcCxy`.
Resolve access to that existing project before activation; do not create a replacement project.

## Rollback

Record the prior deployments before changing each service. The previous creative-vision deployment is
`2c82f788-a900-4edf-8e65-e7a709a1268d`; the prior worker is listed above. Roll back service images independently,
and set the hosted flag to false plus redeploy to restore the old home. Retain the Old studio entry during rollout.
Do not drop tables, delete bucket objects or alter queued records as a rollback shortcut.

Legacy compositor/region-editor removal remains a separate PR after two weeks of successful use.
