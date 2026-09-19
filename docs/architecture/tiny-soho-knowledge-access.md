# Tiny Soho creative-knowledge access decision (TS-R01)

Status: decision recorded; no Supabase DDL has been applied.

## Decision

Tiny Soho creative knowledge is proprietary and must use a private, server-only read path. The local studio must not use a Supabase publishable key or anonymous Data API access for this corpus, even when that key is held only by Next.js. The previous publishable-key reader is disabled pending TS-R02.

TS-R02 will add a direct Postgres reader authenticated as the dedicated `tiny_soho_studio_reader` role. Its connection string and password remain in owner-readable local configuration and are never exposed to the browser, source tree, logs, or proposal data. The role receives `SELECT` only on the five tables used by the current retrieval implementation: `ts_techniques`, `ts_segments`, `ts_shots`, `ts_carousel_slides`, and `ts_tool_guides`.

The exact proposed database change is [ts-r01-private-reader.sql](../../supabase/proposed/ts-r01-private-reader.sql). It is deliberately outside `supabase/migrations/` and must not be applied without a separate explicit approval.

## Read-only audit findings

The connected Supabase project was queried read-only during TS-R01. No migration is recorded in its migration history.

- All 14 `public.ts_*` tables are owned by `postgres`, have RLS enabled, and grant `SELECT` plus all write privileges to `anon`, `authenticated`, and `service_role`.
- `postgres` owns the tables and bypasses RLS. `service_role` also bypasses RLS and has all write privileges.
- Twelve tables have a `pipeline all` policy for `public`, `FOR ALL`, with unconditional `USING` and `WITH CHECK` expressions. `ts_carousel_slides` and `ts_slide_techniques` currently have RLS enabled without a policy; their grants are still broader than intended, but RLS denies their rows until a policy exists.
- The current Tiny Soho source contains no ingestion writer. A targeted search of the sibling `insta-automation` checkout found only prior audit material, not an active `ts_*` writer. This proves neither that no external writer exists nor which credential an active deployment uses.

## Known writers and migration risk

| Role or path | Observed capability | Confidence |
| --- | --- | --- |
| `postgres` | Owner and RLS-bypassing writer for all audited tables | Live grant and ownership query |
| `service_role` | RLS-bypassing writer for all audited tables | Live grant query |
| `anon` and `authenticated` | Direct DML grants on all audited tables; unconditional RLS mutation path on 12 | Live grant and policy query |
| Application ingestion job | Source path and active credential unknown | Not established by this audit |

Revoking public writes must not be applied until the active ingestion job is identified and verified against a staging copy. If it uses `anon` or `authenticated`, its writes will fail after the proposal. If it uses `postgres` or `service_role`, the proposal preserves its current table privileges, but it still requires a post-change ingestion smoke test.

## TS-R02 entry criteria

1. Confirm the active ingestion writer role and deployment path.
2. Provision a strong password for `tiny_soho_studio_reader` outside source control.
3. Implement and test the private direct-reader adapter locally or in staging; do not reuse a `service_role` credential for read-only access.
4. Obtain explicit approval for the proposed migration.
5. Apply it through the approved Supabase migration path, then verify policies, grants, anonymous denial, private-reader retrieval, and ingestion.

The Supabase security advisors also report findings outside this `ts_*` scope. They are not remediated by this ticket.
