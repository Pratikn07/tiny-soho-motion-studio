# B1 · Layered slide upload and storage

| | |
|---|---|
| Track | Backend |
| Agent | Backend agent |
| Depends on | T0 |
| Unblocks | B2, U1 integration, B3 |
| Owned paths | `hosted/app/api/creations/route.ts`, `hosted/app/api/creations/[id]/route.ts`, `hosted/app/api/creations/[id]/slides/[slideId]/layers/**`, `hosted/lib/creations.ts` (new), `hosted/lib/repo/creations.ts` (new), `hosted/tests/creations-*.test.ts` |
| Branch | `task/b1-layered-upload` |

## Why

Each slide now arrives as two files: a background (child, food, props, no text) and a transparent text layer (every
word, logo, heart, divider, card). Today the app only knows one flat `source-image` per slide
(`hosted/app/api/carousel/upload/route.ts`) and stores the whole draft in `carousel_document`. This task adds the v2
creation document and the two-layer upload, reusing the existing signed-upload pattern.

## Design

- **Create / list / read / save** a v2 creation (`CreationDocumentV2` from T0) in
  `creative_studio_projects.carousel_document`, with the existing optimistic `carousel_revision` check (409
  `carousel_revision_conflict`). A v2 document has `version: 2`; list only returns v2 creations from
  `/api/creations` (legacy ones stay under `/api/carousel`).
- **Upload, two steps, same as today's carousel upload:**
  1. `POST .../slides/:slideId/layers` with `{ background: {assetId, fileName, mime, size}, text?: {...} }` returns
     signed upload URLs for `owners/{uid}/projects/{pid}/slides/{slideId}/background-{assetId}.{ext}` and
     `.../text-{assetId}.png` (`upsert:false`).
  2. `PUT .../slides/:slideId/layers` downloads each object, validates it (`validateSourceImage` limits: 25 MB,
     40 MP; text layer must be PNG), inserts `creative_studio_assets` rows with kinds `background-image` and
     `text-layer`, writes the asset ids and `width/height` into the slide, and returns `UploadCheckResult` from B2
     (until B2 lands, a stub that only checks sizes match).
- **Idempotent on asset id**, like today. Re-uploading a layer replaces the slide's reference, not the old asset.
- **A slide without a text layer is allowed** (no text animation). A slide without a background is not.
- **Pairing files** is the UI's job (U1); the API always receives an explicit background and text per slide.

## Implementation plan

1. Add `hosted/lib/creations.ts`: parse/serialise v2 documents with T0's zod schema; helpers to find a slide and
   set its layers.
2. Add repository methods in `hosted/lib/repo/creations.ts` (not in the shared `repository.ts`): `listCreations`,
   `createCreation`, `getCreation`, `saveCreation` (revision check), `insertLayerAsset`. Reuse the Supabase client
   and `owner_user_id` filtering from `StudioRepository`.
3. Routes: `hosted/app/api/creations/route.ts`, `[id]/route.ts`, `[id]/slides/[slideId]/layers/route.ts`. Reuse
   `requireOwner`, `hosted/lib/storage.ts` signing helpers and `hosted/lib/http.ts` responses.
4. Tests (vitest, mocked Supabase like `hosted/tests/carousel-routes.test.ts`): create, save with conflict, upload
   both layers, reject a JPEG text layer, reject mismatched sizes (stub check), idempotent PUT, another owner's
   project returns 404.

## Gate

- 10 slide pairs uploaded to staging through the API; every asset row has the right kind, owner and path.
- `npm --prefix hosted test` and `npm --prefix hosted run check` pass; legacy carousel tests unchanged.

## Out of scope

Upload checks beyond size matching (B2), UI (U1), the legacy `/api/carousel` routes.
