# T0 · Contract: data model, API shapes, states, provider interface

| | |
|---|---|
| Track | Contract (merge before every other task) |
| Agent | Backend agent, reviewed by the UI and pipeline agents |
| Depends on | — |
| Unblocks | Every task |
| Owned paths | `hosted/lib/contract/**` (new), `supabase/migrations/<new>_creation_v2.sql`, this file |
| Branch | `task/t0-contract` |

## Why

Several agents build the backend, pipeline and UI in parallel. They can only meet in the middle if every shape is
fixed first: the creation document, the tables, the endpoints, the job and run states, the provider interface, the
model catalog entry and the AI review JSON. This task defines those shapes as TypeScript types plus zod schemas
and one SQL migration, and changes no behaviour.

## Design

### Principles

- **New shapes live beside the old ones.** The current `/api/carousel/*` flow (single rectangle, `wan2.7-i2v`)
  keeps working until O2 removes it. New endpoints go under `/api/creations/*`; the new document is version 2.
- **Ownership stays as today**: `requireOwner` (`hosted/lib/auth.ts`) plus `owner_user_id` filters in
  `StudioRepository`; tables keep RLS enabled with no policies (service role only).
- **Percent coordinates** for anything drawn over a slide; pixel sizes only for files.

### Creation document v2 (stored in `creative_studio_projects.carousel_document`, versioned)

```ts
type CreationDocumentV2 = {
  version: 2;
  name: string;
  defaults: {
    modelId: string;                 // catalog id, e.g. "ltx-2.5-distilled"
    motionStyle: "calm" | "lively";  // maps to end-frame strength 0.6 / 0.4 (P2)
    textAnimation: TextAnimation;
  };
  slides: SlideV2[];
};

type SlideV2 = {
  id: string;                         // uuid
  name: string;
  order: number;
  width: number; height: number;      // both layers must match (B2)
  layers: {
    backgroundAssetId: string | null; // kind "background-image"
    textAssetId: string | null;       // kind "text-layer" (PNG with alpha); null = no text animation
  };
  checks?: UploadCheckResult;         // B2
  reviewRunId?: string;               // P1, latest review
  motion?: {
    source: "suggestion" | "creator";
    suggestionIndex?: number;
    story: string;                    // plain-language, shown to the creator
    prompt: string;                   // model prompt (P1 writes it)
    motionStyle?: "calm" | "lively";  // overrides defaults
  };
  modelId?: string;                   // overrides defaults
  textAnimation?: TextAnimation;      // overrides defaults
  latestRunId?: string;               // B3
  chosenTakeId?: string;
};

type TextAnimation = {
  style: "none" | "fade" | "fade-rise";   // benchmark default: fade-rise
  firstAt: number;  // s, default 0.2
  step: number;     // s between lines, default 0.14
  fade: number;     // s, default 0.35
  rise: number;     // px, default 18
  coverFrame: "first" | "last";           // Instagram thumbnail; "last" shows full text
};

type UploadCheckResult = {
  ok: boolean;
  items: { code: UploadCheckCode; severity: "error" | "warning" | "info"; message: string }[];
  textLayer?: { solidPercent: number; partialPercent: number; hazePercent: number; lines: number };
  generationSize?: { width: number; height: number };   // multiples of 64, ~737k px (P2)
};
type UploadCheckCode = "size_mismatch" | "no_alpha" | "text_not_solid" | "text_haze" | "ratio_unsupported"
  | "too_large" | "background_has_text";
```

### Tables (one migration)

- `creative_studio_assets.kind`: add `background-image` (jpeg/png/webp) and `text-layer` (png only).
- `creative_studio_jobs`: add `provider text not null default 'alibaba'`, `seed integer`, `cost_usd numeric`,
  `gpu_seconds numeric`. Fix `creative_studio_job_events.event_type` to allow every job status (B4 depends on it).
- New `creative_studio_review_runs`: `id, owner_user_id, project_id, slide_id, reviewer_model, input_fingerprint,
  status (queued|running|completed|failed), result jsonb (SlideReview), creator_idea text, creator_idea_result
  jsonb, cost_usd, created_at, updated_at`.
- New `creative_studio_pipeline_runs` (one per "generate this slide" request): `id, owner_user_id, project_id,
  slide_id, idempotency_key (unique per project), model_id, provider, prompt, motion_style, seeds_planned int[],
  max_attempts, status, attempt_count, budget_reserved_usd, worker_lease_id, worker_lease_expires_at,
  next_step_at, error_code, created_at, updated_at`.
- New `creative_studio_takes` (one per seed attempt): `id, run_id, owner_user_id, project_id, slide_id, job_id,
  seed, raw_asset_id, final_asset_id, checks jsonb (TakeChecks), verdict (pending|accepted|rejected), created_at`.
- New `creative_studio_spend` (ledger, O1): `id, owner_user_id, provider, model_id, job_id, take_id, review_run_id,
  usd, gpu_seconds, occurred_at`.
- Claim RPCs for pipeline runs follow the existing pattern (`FOR UPDATE SKIP LOCKED`, lease, service_role only).

### States

```text
Pipeline run:  queued → generating → finishing → checking → completed
                                   ↘ (take rejected, attempts left) → generating
               any → needs_attention | failed | canceled
Take verdict:  pending → accepted | rejected
Provider job:  existing states (hosted/lib/jobs.ts) unchanged; every state is a valid event_type
```

### Endpoints (owner-only, JSON, `hosted/app/api/creations/**`)

| Method and path | Purpose | Task |
|---|---|---|
| `GET/POST /api/creations` | List / create a v2 creation | B1 |
| `GET/PUT /api/creations/:id` | Read / save the document (optimistic `revision`, 409 on conflict, like today) | B1 |
| `POST /api/creations/:id/slides/:slideId/layers` | Signed upload URLs for `background` and `text` | B1 |
| `PUT /api/creations/:id/slides/:slideId/layers` | Finalise uploads, run checks, return `UploadCheckResult` | B1, B2 |
| `POST /api/creations/:id/slides/:slideId/review` | Start an AI review; returns a review run | P1 |
| `POST /api/creations/:id/slides/:slideId/idea-check` | Check the creator's own motion idea | P1 |
| `GET /api/review-runs/:id` | Review status and `SlideReview` | P1 |
| `POST /api/creations/:id/slides/:slideId/runs` | Start a pipeline run (`modelId`, `motion`, `seeds`, `idempotencyKey`) | B3 |
| `GET /api/runs/:id` | Run state, takes, check results, signed URLs (300 s) | B3 |
| `POST /api/runs/:id/cancel`, `POST /api/runs/:id/retry` | Cancel / add one attempt | B3 |
| `POST /api/creations/:id/slides/:slideId/choose` | Set `chosenTakeId` | B3 |
| `GET /api/catalog` | Enabled models with capabilities and cost per clip | B5 |
| `GET /api/budget` | Month-to-date spend, cap, remaining | O1 |

Errors use the existing `hosted/lib/errors.ts` codes plus: `budget_exceeded`, `model_unsupported_for_slide`,
`layers_missing`, `layers_invalid`, `review_unavailable`, `run_in_progress`.

### Provider interface (used by B5's router, implemented by P2 and P3)

```ts
interface VideoProvider {
  id: "modal-ltx" | "alibaba";
  submit(input: GenerationInput): Promise<{ providerTaskId: string }>;  // idempotent on input.idempotencyKey
  poll(providerTaskId: string): Promise<ProviderPoll>;
}
type GenerationInput = {
  idempotencyKey: string;           // = take id
  modelId: string;
  backgroundUrl: string;            // signed, ≤ 300 s, background layer only; the text layer is never sent
  outputUploadUrl?: string;         // signed upload URL for providers that push results (Modal)
  prompt: string;
  seed: number;
  width: number; height: number;    // generation size
  frames: number; fps: number;      // 121, 24
  endFrame?: { strength: number };  // same background at the last frame
};
type ProviderPoll =
  | { state: "running" }
  | { state: "succeeded"; resultUrl?: string; uploaded?: boolean; gpuSeconds?: number; costUsd?: number;
      peakGib?: number }
  | { state: "failed"; errorCode: string };
```

### Model catalog entry (B5)

```ts
type CatalogModel = {
  id: string; provider: "modal-ltx" | "alibaba"; providerModel: string;
  label: string; description: string;          // plain language for the selector
  pricing: { unit: "gpu_second" | "video_second"; usd: number; source: string; checkedAt: string };
  estimatedClipUsd: number;                     // shown in the UI
  supports: { endFrame: boolean; seeds: boolean; sizes: "multiple-of-64" | string[]; durationsSeconds: number[] };
  promptProfile: "ltx" | "wan";
  calibrated: boolean;                          // passed the known-slides benchmark (P5)
  enabled: boolean;
  requiresBillingAck: boolean;
};
```

### AI review result (P1; matches the playbook's output format)

`SlideReview` is the JSON object in `docs/strategy/motion-agent-playbook.md` ("Output format"): `subject,
message, text_zones, clearance_percent, risks[], suggestions[3] {title, risk, end_strength, prompt},
design_advice, creator_idea_review`. Store it as returned after zod validation; reject and retry once on invalid
JSON.

### Take checks (P5)

```ts
type TakeChecks = {
  cameraDrift: number;          // pass < 12
  behindTextPercent: number;    // pass < 9 (letter pixels of the worst line)
  behindTextLine?: number; behindTextAtSeconds?: number;
  loopDifference: number;       // pass < 5
  textDrift?: number;           // final vs text layer, ~2-3 expected
  reasons: string[];            // plain-language failure reasons for the UI
};
```

## Implementation plan

1. Create `hosted/lib/contract/` with `creation.ts`, `runs.ts`, `provider.ts`, `catalog.ts`, `review.ts`,
   `checks.ts`: types plus zod schemas, no behaviour. Export sample fixtures for every type
   (`hosted/lib/contract/fixtures/*.json`) so UI agents can mock against them.
2. Write the migration `supabase/migrations/<timestamp>_creation_v2.sql` (tables, kinds, columns, event_type fix,
   claim RPC for pipeline runs). Keep all existing columns and constraints that the legacy flow needs.
3. Add a `docs/tasks/T0-contract.md` changelog section at the bottom for later amendments.
4. Unit tests: every fixture parses with its schema; invalid samples fail (wrong kind, missing layer, bad state).
5. Apply the migration to a local or staging Supabase and run the existing test suites to prove nothing broke.

## Gate

- All fixtures validate; `npm --prefix hosted test` and `npm --prefix hosted run check` pass.
- Migration applies cleanly on a fresh database and on a copy of the current schema; legacy carousel tests pass.
- UI, backend and pipeline agents have each confirmed in the PR that the shapes cover their task.

## Out of scope

Endpoint handlers, UI, workers. Only shapes, fixtures and the migration.

## Changelog

- 2026-09-30: first version.
- 2026-09-30 (proposed by P4, needs Agent 1's review; affects the T0 migration):
  - `creative_studio_vision_jobs.operation` also allows `finish` (P4) and `check` (P5).
  - New nullable column `creative_studio_vision_jobs.result jsonb` for operation results. The worker writes it
    only for jobs that return data (finish, check), so legacy operations are unaffected.
  - `finish` job: `source_asset_id` = raw clip (`generated-video`, MP4); `input_asset_ids` = background layer and,
    if present, the text layer; `options` = `{ takeId, backgroundAssetId, textAssetId | null, width, height,
    textAnimation?: TextAnimation }` (slide size in px). Outputs, in order: `final.mp4` (`derived-video`) and
    `cover.png` (`derived-image`, colour-matched last frame with the full text layer), both at
    `owners/{uid}/projects/{pid}/takes/{takeId}/`. An asset already recorded at those paths counts as done.
    `result`: `{ lines, textInBy, step, colourGains: [r, g, b], style, coverFrame }`. If all lines would not be in
    by 4.5 s, `step` is shortened so the last seconds always show the full design.
  - Capability `finish` is advertised in `creative_studio_vision_capabilities`.
