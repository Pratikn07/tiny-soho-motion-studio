# O2 · Release: feature flag, deploy, docs and production verification

| | |
|---|---|
| Track | Ops |
| Agent | Backend or ops agent, with the owner for the final check |
| Depends on | All other tasks |
| Unblocks | Daily use |
| Owned paths | `hosted/lib/env.ts` (flag), deployment configs (`hosted/vercel.json`, `creative-worker/railway.toml`, `creative-vision/railway.toml`, `providers/modal-ltx/`), `PRODUCT.md`, `hosted/README.md`, `docs/architecture/**`, legacy carousel removal |
| Branch | `task/o2-release` |

## Why

Many components change at once (database, hosted app, worker, creative-vision, a new Modal app). They must be
deployed in the right order, verified with a real carousel, and documented, while the old flow stays available
until the new one is proven.

## Design and plan

1. **Feature flag** `TINY_SOHO_CREATIONS_V2` (owner-only). When on, the home screen opens the new creation flow;
   "Old studio" stays in the tools menu.
2. **Deploy order**: migration (T0) → creative-vision with `finish` and `check` → Modal app `tiny-soho-ltx`
   (`modal deploy`) → worker with the pipeline tick and providers → hosted app. Each step verified before the next;
   the release doc (`docs/architecture/hosted-creative-suite-release.md`) is updated with the new order.
3. **Secrets**: Modal token for the worker, Alibaba credentials unchanged, AI review key (if P1 picks an API model).
   Server-side only; confirm none are in client bundles (`next build` output check).
4. **Production verification**: the creator makes a real 10-slide layered carousel. Record: slides accepted within
   2 retries (target 8 of 10), text exactness, total cost, time from upload to downloads, anything confusing.
5. **Docs**: update `PRODUCT.md` (currently says NVIDIA analysis and live generation are not working) and
   `hosted/README.md` (says "Motion Studio", omits the NVIDIA env vars and creative-vision) to match the new flow.
6. **Legal**: turn on Instagram's AI label for LTX-made posts (LTX licence requires AI disclosure); note the
   licence conditions in `PRODUCT.md`.
7. **Legacy removal** (separate PR after two weeks of use): remove the rectangle compositor path, the region editor,
   and the hard-coded `wan2.7-i2v` flow, keeping Alibaba available through the router.

## Gate

The roadmap's release gate: a 10-slide layered carousel completed in production by the creator without help, at
least 8 of 10 slides accepted within 2 retries, text pixel-exact, spend visible and capped.

## Out of scope

Opening the studio to other creators (tenancy, payments, quotas, and the LTX competitor clause would all need
review first).
