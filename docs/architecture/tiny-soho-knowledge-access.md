# Tiny Soho creative-knowledge access decision (TS-R01)

Status: production reader reconciled on 20 September 2026. This document retains the earlier decision history; the current runtime state is recorded in [current-runtime-state.md](./current-runtime-state.md).

## Decision

Tiny Soho creative knowledge is proprietary and must use a private, server-only read path. The local studio must not use a Supabase publishable key or anonymous Data API access for this corpus, even when that key is held only by Next.js. The previous publishable-key reader is disabled pending TS-R02.

TS-R02 will add a direct Postgres reader authenticated as the dedicated `tiny_soho_studio_reader` role. Its connection string and password remain in owner-readable local configuration and are never exposed to the browser, source tree, logs, or proposal data. The role receives `SELECT` only on the five tables used by the current retrieval implementation: `ts_techniques`, `ts_segments`, `ts_shots`, `ts_carousel_slides`, and `ts_tool_guides`.

The historical proposed database changes are deliberately outside `supabase/migrations/`. They are audit artifacts, not migrations to rerun. The production `tiny_soho_studio_reader` role now exists, so a proposal that creates it must never be applied again.

## Audit boundary

The TS-R01 audit identified legacy access broader than the private-reader target. Publishable-key retrieval remains disabled. Detailed live audit data, including role, policy, and ingestion-path observations, is intentionally kept outside this public repository.

No database change may be applied until the active ingestion writer is identified and a staging validation confirms that the proposed least-privilege path preserves required ingestion behavior.

## TS-R02A discovery status

Status: provisionally identified. Evidence outside this public repository identifies an external scheduled/manual ingestion process using a service-role-class credential. A live read-only check also corrected one supplied audit claim: RLS is enabled on every target table, including `ts_carousel_slides` and `ts_slide_techniques`; those two tables currently have no policies.

No production database privilege, policy, or retrieval change was made during discovery.

## TS-R02C staging validation

Status: completed in a separate, no-production-data Supabase staging project. The staging harness mirrors the five tables used by retrieval, provisions `tiny_soho_studio_reader`, and uses a synthetic technique fixture only. The role was verified to allow `SELECT` on `ts_techniques`, `ts_segments`, `ts_shots`, `ts_carousel_slides`, and `ts_tool_guides`; it was denied unrelated reads, all tested mutations and DDL, privileged role switching, and every accessible `SECURITY DEFINER` function.

The application reader is server-only and disabled by default. It requires all of the following before it can connect: `TINY_SOHO_KNOWLEDGE_ENABLED=true`, a direct PostgreSQL URL whose user is exactly `tiny_soho_studio_reader`, and an absolute `TINY_SOHO_KNOWLEDGE_DATABASE_CA_PATH`. It uses CA-pinned TLS verification, a two-connection pool, a three-second connect/statement timeout, static allowlisted SQL, bound search values, and read-only transactions. `sslmode` is deliberately rejected in the URL because the Node driver can let a URL-level SSL mode override the explicit CA configuration.

The staging bootstrap is [ts-r02c-staging-reader.sql](../../supabase/staging/ts-r02c-staging-reader.sql). It is not a production migration. The [production draft](../../supabase/proposed/ts-r02c-production-reader.sql) and [rollback draft](../../supabase/proposed/ts-r02c-production-reader-rollback.sql) are historical proposals. They do not describe the current production state and must not be re-applied.

The 2026-09-18 production preflight found legacy public read access on the five target tables and a publicly executable `SECURITY DEFINER` function. On 20 September 2026, a fresh read-only production check confirmed the dedicated reader has the intended least-privilege grants and policies, while `anon`/`authenticated` do not have grants to those five tables and neither `PUBLIC` nor the reader can execute `public.rls_auto_enable()`. See the current state record for the exact evidence and remaining activation gate.

## TS-R02 entry criteria

1. Keep `TINY_SOHO_KNOWLEDGE_ENABLED=false` in repository defaults.
2. Obtain the existing owner-controlled reader credential and trusted CA path; do not rotate the role automatically.
3. Verify an authenticated, CA-pinned server-side retrieval smoke before enabling the feature in an owner-controlled runtime configuration.

The Supabase security advisors also report findings outside this `ts_*` scope. They are not remediated by this ticket.
