# O1 · Spend ledger, monthly cap and cost per accepted clip

| | |
|---|---|
| Track | Ops |
| Agent | Backend agent |
| Depends on | B5 (catalog prices), B3 (reserve before each job) |
| Unblocks | U2 cost line, O2 |
| Owned paths | `hosted/lib/budget.ts` (new), `hosted/app/api/budget/**`, `creative-worker/src/budget.ts` (new), a small budget card in `hosted/components/creation/budget/**`, tests |
| Branch | `task/o1-cost-budget` |

## Why

The target is at most $50 a month across every provider. Modal bills per GPU second; Alibaba bills per video second
and costs roughly 14× more per clip; AI reviews may cost a little each. Retries add up. The cap must be a hard stop,
not a dashboard warning.

## Design

- **Ledger** (`creative_studio_spend`, T0): one row per paid call (provider job, AI review) with USD and GPU
  seconds; written when the provider reports completion, using measured GPU seconds × catalog price for Modal and
  video seconds × price for Alibaba.
- **Reserve before spend**: `reserve(ownerId, estimatedUsd)` checks month-to-date spend + open reservations against
  the cap (default $50, configurable); refuses with `budget_exceeded`. Reservations are released or converted when
  the job finishes.
- **`GET /api/budget`**: month-to-date spend by provider, cap, remaining, clips accepted this month, cost per accepted
  clip, and the Modal free credit note (not guaranteed).
- **Budget card** in the creation UI: "This month: $6.40 of $50 · 214 clips · $0.03 per accepted clip".
- **Reconciliation**: a weekly manual check against the Modal and Alibaba billing pages, recorded in the PR or a
  runbook; if they drift more than 10%, update the catalog prices.

## Implementation plan

1. Ledger writes from the worker when jobs complete (Modal: GPU seconds from P2; Alibaba: duration × price).
2. Reserve/convert/release logic with a transaction or row lock so two runs cannot both pass the last dollars.
3. Budget endpoint and card.
4. Tests: cap refusal, concurrent reservations, month rollover, cost per accepted clip.

## Gate

- With the cap set to $0.10 on staging, the second paid take is refused before any provider call.
- The budget card matches the ledger; hosted and worker tests and `check` pass.

## Out of scope

Multi-user billing, payments, quotas for other creators.
