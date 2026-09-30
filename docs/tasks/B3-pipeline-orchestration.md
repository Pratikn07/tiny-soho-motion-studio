# B3 · Server-side pipeline runs

| | |
|---|---|
| Track | Backend |
| Agent | Backend agent |
| Depends on | T0. Integrates B5 (router), P2/P3 (providers), P4 (finishing), P5 (checks); build against their interfaces with fakes first |
| Unblocks | U3, O1, O2 |
| Owned paths | `creative-worker/src/pipeline/**` (new), `creative-worker/src/index.ts` (register the tick), `hosted/app/api/creations/[id]/slides/[slideId]/runs/**`, `hosted/app/api/runs/**`, `hosted/app/api/creations/[id]/slides/[slideId]/choose/**`, tests for these |
| Branch | `task/b3-pipeline` |

## Why

Today the browser drives everything: `useCarouselWorkspace.ts` polls every 4 s and calls generate, then compose,
itself. Closing the page stops the pipeline. The roadmap's gate is that the creator can start a carousel, leave,
and come back to finished takes. The pipeline also has more steps now (several seeds, finishing, checks, retries),
which must run on the server.

## Design

- **One pipeline run per "generate this slide" request** (`creative_studio_pipeline_runs`, T0), created by
  `POST /api/creations/:id/slides/:slideId/runs` with an idempotency key, so a refresh or double-click returns the
  same run.
- **Orchestrator in `creative-worker`** (already leases jobs and ticks every second). A new tick claims runs with the
  T0 claim RPC and advances one step at a time:

```text
queued ─► generating: for the next planned seed, create a take + a provider job via the router (B5)
        ─► wait for the job (worker's existing job loop runs the provider)
finishing: create a creative-vision job `finish` (P4) with raw video + text layer + TextAnimation
checking: creative-vision job `check` (P5) returns TakeChecks and a verdict
          accepted  → run completed (keep going only if the creator asked for more takes)
          rejected  → next seed if attempts remain, else needs_attention with reasons
```

- **Budget before spend**: before each provider job, ask O1's `reserve(usd)`; if the cap would be exceeded, stop
  with `budget_exceeded` and no charge.
- **Defaults**: 2 seeds planned, `max_attempts = 3` per run (so at most 3 paid generations). The creator can press
  "try another take" (`POST /api/runs/:id/retry`, +1 attempt, budget-checked).
- **Cancel** stops scheduling new work; an in-flight provider job finishes and is recorded (it is already paid).
- **Read API** `GET /api/runs/:id`: state, attempt count, takes with `TakeChecks`, verdict, plain-language reasons,
  and 300 s signed URLs for raw and final videos. `choose` sets `chosenTakeId` in the document.
- **The legacy flow keeps working**: nothing here changes `/api/carousel/*` or the existing job tick.

## Implementation plan

1. Pipeline state machine as pure functions (`creative-worker/src/pipeline/steps.ts`), each taking the run plus
   injected dependencies (router, vision client, budget, repository), like `processClaimedJob` today.
2. Claim, lease renewal and step scheduling (`next_step_at`), mirroring `claim_creative_studio_job`.
3. Hosted routes for create/read/cancel/retry/choose, with ownership checks and idempotency (reuse
   `hosted/lib/jobs.ts:createOrGetJob` patterns).
4. Fakes for router, vision and budget; tests for: happy path; rejected take then accepted on seed 2; all rejected →
   `needs_attention` with reasons; budget refusal; cancel mid-run; duplicate create returns the same run; worker
   crash mid-step resumes from the lease.
5. Integration test on staging once P2, P4 and P5 are merged: one real slide end to end.

## Gate

- Start a run, close the browser, reopen: the run finished and shows takes with checks.
- A forced failure (fake provider error, then a crash between steps) recovers without a duplicate paid job.
- `npm --prefix creative-worker test`, `npm --prefix hosted test` and both `check` scripts pass.

## Out of scope

The provider calls themselves (P2, P3), finishing and checks (P4, P5), UI (U3).
