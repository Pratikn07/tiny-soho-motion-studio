# B5 · Model catalog, provider router and billing acknowledgement

| | |
|---|---|
| Track | Backend |
| Agent | Backend agent |
| Depends on | T0 |
| Unblocks | P2/P3 registration, B3, U2 (model selector), O1 |
| Owned paths | `hosted/lib/catalog/**` (new), `hosted/app/api/catalog/**`, `creative-worker/src/router.ts` (new), `creative-worker/src/providers/index.ts` (registry only), `hosted/lib/model-acknowledgements.ts` (generalise), tests |
| Branch | `task/b5-catalog-router` |

## Why

The creator should choose how videos are made: LTX (default, cheap, tested) or Alibaba's Wan models. Today the
carousel hard-codes `wan2.7-i2v` in two places (`hosted/app/api/carousel/[id]/generate/route.ts:40`,
`hosted/components/carousel/useCarouselWorkspace.ts:97`). The existing catalog `hosted/lib/video-catalog.ts`
(`SINGAPORE_VIDEO_MODELS`) describes Alibaba contracts in detail but has no provider field, no prices and no
end-frame capability, and the acknowledgement is hard-coded as `"alibaba-billing-v1"`.

## Design

- **Catalog in config** (`hosted/lib/catalog/models.ts`), entries of T0's `CatalogModel`. Start with three:

| id | provider | Shown as | Cost per 5 s clip | endFrame |
|---|---|---|---|---|
| `ltx-2.5-distilled` | `modal-ltx` | Recommended: fast, keeps the child in place, loops | ~$0.03 (measured: 36 s × $0.000842/s) | yes |
| `wan2.7-i2v` | `alibaba` | What the app used before | ~$0.50 (list $0.10/s; recheck) | P3 decides |
| `wan3-i2v` | `alibaba` | Newer Wan | ~$0.35–0.50 (list; recheck) | P3 decides |

  Alibaba entries reference the existing contracts in `video-catalog.ts` rather than duplicating them. Prices carry
  `source` and `checkedAt`; `calibrated` stays false until P5's known-slides benchmark passes for that model.
- **`GET /api/catalog`**: enabled models, plain-language labels, capabilities, `estimatedClipUsd`, and for a given
  slide (`?slideId=`) whether each model fits (for example no end frame → "may let the child walk into the text").
- **Router** (`creative-worker/src/router.ts`): `route(take) → VideoProvider` by the take's `modelId`. Rules, in
  order: the creator's per-slide choice, then the creation default, then `ltx-2.5-distilled`. Fallback to another
  provider only when the creator allowed it for this run (U2 asks first; no silent switch to a 14× more expensive
  model). Every job records `provider` and `model_id` (T0 columns).
- **Billing acknowledgement, generalised**: one acknowledgement per provider and price version (`modal-billing-v1`,
  `alibaba-billing-v1`), required once before that provider's first paid job. Existing Alibaba acknowledgements stay
  valid.

## Implementation plan

1. Catalog module + tests (every entry valid against T0's schema; Alibaba entries resolve to an existing contract).
2. `GET /api/catalog` route with the per-slide fit logic.
3. Router + provider registry with a fake provider; tests for choice order and "no silent fallback".
4. Generalise acknowledgements (`hosted/lib/model-acknowledgements.ts`, `repository.ts` constant) with a migration
   note in T0's changelog if a column is needed.
5. Remove the two hard-coded `wan2.7-i2v` references only in the new v2 path; leave the legacy path until O2.

## Gate

- `GET /api/catalog` lists three models with costs; LTX marked default.
- A take with `modelId: "wan2.7-i2v"` routes to the Alibaba provider, a take with no choice routes to LTX, and a
  failed LTX take is never re-sent to Alibaba unless the run allows fallback.
- Hosted and worker tests and `check` scripts pass.

## Out of scope

The providers themselves (P2, P3), the selector UI (U2), spend tracking (O1).
