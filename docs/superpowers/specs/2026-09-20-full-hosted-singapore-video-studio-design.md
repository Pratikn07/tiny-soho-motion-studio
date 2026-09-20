# Full Hosted Singapore Video Studio Design

## Goal

Replace the deliberately narrow two-model hosted Motion Studio with an owner-only Tiny Soho Creative Studio that exposes every currently documented general-purpose Alibaba Model Studio video capability available in the Singapore (International) region. Projects, private media, acknowledgements, jobs, outputs, and creative plans are durable in the existing Tiny Soho Supabase project; Creative processing remains isolated from Instagram automation.

## Scope and source of truth

The source of truth is the Singapore/International section of Alibaba's current Video Generation catalogue, not the Beijing-only catalogue and not the old local five-model allowlist. The versioned source registry contains:

| Family | Provider models or modes | Inputs |
| --- | --- | --- |
| Text to video | `wan2.7-t2v-2026-06-12`, `wan2.7-t2v-2026-04-25`, `wan2.7-t2v`, `wan2.6-t2v`, `wan2.5-t2v-preview`, `wan2.2-t2v-plus`, `wan2.1-t2v-turbo`, `wan2.1-t2v-plus`, `wan3.0-video`, `wan3.0-video-prime` | Prompt and supported options |
| Image to video | `wan2.7-i2v-2026-04-25`, `wan2.7-i2v`, `wan2.6-i2v-flash`, `wan2.6-i2v`, `wan2.5-i2v-preview`, `wan2.2-i2v-flash`, `wan2.2-i2v-plus`, `wan2.1-i2v-plus`, `wan2.1-i2v-turbo` | First frame; Wan 2.7 can also accept permitted last frame, driving audio, and first clip |
| First/last-frame video | `wan2.2-kf2v-flash`, `wan2.1-kf2v-plus` | First and last image frames |
| Reference to video | `wan2.7-r2v-2026-06-12`, `wan2.7-r2v`, `wan2.6-r2v-flash`, `wan2.6-r2v`, `wan3.0-video`, `wan3.0-video-prime` | Prompt plus ordered reference media |
| Video edit | `wan2.7-videoedit`, `wan2.1-vace-plus` | Source video plus documented controls |
| Character motion and swap | `wan2.2-animate-move` and `wan2.2-animate-mix`, both `wan-std` and `wan-pro` | Documented source, reference, and driving video |

The owner UI shows every registry entry even when workspace entitlement or quota is unknown. A provider access, quota, or contract error becomes a durable `needs_attention` job; it is not hidden, retried under a different model, or sent to another region. Beijing-only Digital Human and Emoji models are excluded because the workspace is Singapore.

Alibaba does not expose a documented workspace-scoped catalogue-list endpoint used by this application. The registry records the official current catalogue and contract version in source. It is independent of the UI so an official provider change is one tested registry update, not an unvalidated free-text model field.

## Architecture

`hosted/` remains the separately deployed Next.js owner frontend and API. Routes validate a Supabase bearer token plus `TINY_SOHO_STUDIO_ADMIN_EMAILS`; browser code receives only the Supabase publishable key. Alibaba, service-role, and worker credentials stay server-only.

Supabase contains only `creative_studio_*` rows and the private `creative-studio` bucket. Before an Alibaba request, the server or worker makes short-lived signed URLs solely for private assets owned by the job owner. Browser-supplied URLs never reach Alibaba.

A new **Tiny Soho Creative Worker** is a separate service and deployment from `insta-automation`: it has a separate service name, source directory, health route, and secret set. It has no Meta credentials, Instagram routes, or imports from automation code. It claims only Creative rows, submits/polls asynchronous Alibaba work, ingests provider output before expiry, and runs Creative-only FFmpeg work. Vercel serves the interface; the worker owns durable lifecycle processing.

## Durable model and job data

The existing project, asset, and job rows remain. A follow-up migration adds:

- `creative_studio_model_acknowledgements`, unique by owner/model/contract version, recording explicit billing acknowledgement.
- `creative_studio_job_media`, one owned asset per constrained media role and stable ordinal; legacy JSON input stays readable for old history.
- `creative_studio_job_events`, append-only safe lifecycle events with no secrets, headers, signed URLs, or raw provider bodies.
- `creative_studio_storyboards`, `creative_studio_storyboard_scenes`, `creative_studio_workflows`, `creative_studio_workflow_runs`, and `creative_studio_director_proposals` for durable hosted planning.

All new tables use UUID keys compatible with existing data, `timestamptz`, RLS with no browser Data API policy, foreign keys with supporting indexes, and status-specific partial indexes for worker claims. A narrow private-schema claim function uses `FOR UPDATE SKIP LOCKED`, a fixed `search_path`, and revoked public execution. It cannot claim a non-Creative job.

## Provider contract boundary

`hosted/lib/video-catalog.ts` defines `VideoModelContract`: stable UI id, exact provider id, task, permitted media roles and order, Zod option schema, Singapore endpoint family, and contract version. `hosted/lib/alibaba/` contains a serializer/parser for text, image/keyframe, reference, edit, and animation request families. A UI selection is valid only after shared preflight; serializers never receive a wrong role, unsupported option, unchecked model, or free-text provider id.

Every submission requires an explicit model-version acknowledgement saying that Alibaba account quota and billing are controlled in Model Studio and selection may incur charges after free quota. It does not claim quota exists and never authorizes a fallback.

## Owner experience

The hosted product has Motion, Storyboards, Workflows, Director, and Assets navigation. Motion renders the correct media slots and settings from the selected contract. Storyboards and workflows create work only through shared preflight and acknowledgement. Director stores sanitized asset metadata and ordered references, then emits a reviewed shared job specification. Vision features requiring Python weights or FFmpeg execute only in the Creative Worker; unavailable optional dependencies are reported as unavailable rather than emulated or delegated to Instagram.

## Security and release boundary

- Do not modify `insta-automation`, its Railway service, Vercel project, Meta credentials, tables, storage paths, triggers, or jobs.
- Do not change existing non-`creative_studio_*` Supabase rows, policies, functions, or buckets.
- Do not expose service-role or Alibaba secrets in client bundles, source, fixtures, logs, or chat.
- Do not invoke a paid-capable Alibaba model as a release test. Production verification can upload a harmless asset and prove blocked-before-acknowledgement without creating a provider task.
- Release requires a reviewed migration, clean new Studio advisor findings, Vercel and Worker deployments from merged `main`, both health checks, authenticated owner smoke, and a read-only Instagram health check proving no automation surface changed.

## Acceptance criteria

1. The deployed Motion view lists every Singapore catalogue entry above and uses model-specific controls.
2. Invalid media, ordering, options, or unacknowledged billing state fail before job creation or provider submission.
3. Jobs, inputs, results, planning artifacts, and safe events survive page closes; outputs are private Storage assets.
4. The dedicated Creative worker processes only Creative state and can be verified independently of Instagram automation.
5. The exact merged `main` SHA is deployed to Vercel and the worker, with successful health checks and no Instagram change.
