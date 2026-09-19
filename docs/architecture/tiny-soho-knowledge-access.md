# Tiny Soho creative-knowledge access decision (TS-R01)

Status: decision recorded; no Supabase DDL has been applied.

## Decision

Tiny Soho creative knowledge is proprietary and must use a private, server-only read path. The local studio must not use a Supabase publishable key or anonymous Data API access for this corpus, even when that key is held only by Next.js. The previous publishable-key reader is disabled pending TS-R02.

TS-R02 will add a direct Postgres reader authenticated as the dedicated `tiny_soho_studio_reader` role. Its connection string and password remain in owner-readable local configuration and are never exposed to the browser, source tree, logs, or proposal data. The role receives `SELECT` only on the five tables used by the current retrieval implementation: `ts_techniques`, `ts_segments`, `ts_shots`, `ts_carousel_slides`, and `ts_tool_guides`.

The exact proposed database change is [ts-r01-private-reader.sql](../../supabase/proposed/ts-r01-private-reader.sql). It is deliberately outside `supabase/migrations/` and must not be applied without a separate explicit approval.

## Audit boundary

The TS-R01 audit identified legacy access broader than the private-reader target. Publishable-key retrieval remains disabled. Detailed live audit data, including role, policy, and ingestion-path observations, is intentionally kept outside this public repository.

No database change may be applied until the active ingestion writer is identified and a staging validation confirms that the proposed least-privilege path preserves required ingestion behavior.

## TS-R02 entry criteria

1. Confirm the active ingestion writer role and deployment path.
2. Provision secure authentication for `tiny_soho_studio_reader` outside source control.
3. Implement and test the private direct-reader adapter locally or in staging; do not reuse a `service_role` credential for read-only access.
4. Obtain explicit approval for the proposed migration.
5. Apply it through the approved Supabase migration path, then verify policies, grants, anonymous denial, private-reader retrieval, and ingestion.

The Supabase security advisors also report findings outside this `ts_*` scope. They are not remediated by this ticket.
