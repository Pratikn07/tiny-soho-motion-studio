# B4 · Worker hardening and existing bugs

| | |
|---|---|
| Track | Backend |
| Agent | Backend agent |
| Depends on | T0 (event_type fix is in T0's migration) |
| Unblocks | B3, P3 (both reuse the job loop) |
| Owned paths | `creative-worker/src/worker.ts`, `creative-worker/src/process-job.ts`, `creative-worker/src/index.ts` (config only), `creative-vision/src/repository.py` (upload retry only), their tests |
| Branch | `task/b4-worker-hardening` |

## Why

The new pipeline runs more jobs and retries, so the existing job loop has to be safe to repeat. Four problems were
found on `main` (`2844033`):

1. **Every "running" update fails.** `creative_studio_job_events.event_type` allows `claimed, submitted, polled,
   downloading, completed, failed, needs_attention, canceled`
   (`supabase/migrations/20260920225246_creative_studio_full_video_catalog.sql:117`), but the worker inserts
   `event_type: status` (`creative-worker/src/worker.ts:152`), and `process-job.ts:46` calls `update("running")`.
   The job row is written, then the event insert throws `creative_job_event_write_failed`.
2. **Duplicate billable submits.** Alibaba submit has no provider-side idempotency; a crash after the POST but
   before the `submitted` update re-submits on the next lease.
3. **Orphaned files.** Ingest uploads to a new random UUID path on every attempt.
4. **Silent lease loss.** The lease-guarded update does not check the number of rows changed; creative-vision uploads
   with `x-upsert:false` to a fixed path, so a retry after a partial upload ends in `needs_attention`.

Also: without DashScope credentials, `workerConfig` returns null and disables the whole worker, including the
director and workflow ticks. With Modal as the default provider, the worker must run without Alibaba credentials.

## Design and plan

1. **Event types**: T0's migration allows every job status. Add a worker test that every status passed to `update`
   is accepted by the constraint list (keep the list in one shared constant).
2. **Submit idempotency**: before submitting, write `submitting` with a `submit_attempt_id`; after the POST, store
   `provider_task_id` in the same guarded update. On re-claim of a `submitting` job with no task id, query the
   provider for a task with that attempt id if the API supports it; otherwise mark `needs_attention` with
   `possible_duplicate_submit` instead of re-submitting blindly.
3. **Deterministic ingest path**: `owners/{uid}/projects/{pid}/generated/{jobId}.mp4`; if the object already exists
   with the right size and type, treat ingest as done.
4. **Row-count checks** on every lease-guarded update; zero rows means the lease was lost, so stop processing that job.
5. **creative-vision uploads**: on "already exists", verify and continue rather than failing.
6. **Per-provider config**: the worker starts without DashScope credentials; Alibaba jobs are skipped (left queued
   with a logged reason) until credentials exist, while other ticks keep running.
7. Tests for each case with the existing fakes in `creative-worker/tests/`.

## Gate

- A job goes `submitting → submitted → running → downloading → completed` with events written for each step.
- A simulated crash after submit does not create a second provider task; a repeated ingest does not create a second
  file; the worker runs with no DashScope env vars.
- `npm --prefix creative-worker test`, `npm --prefix creative-worker run check` and
  `python -m pytest creative-vision/tests -q` pass.

## Out of scope

New providers (P2, P3), the pipeline orchestrator (B3).
