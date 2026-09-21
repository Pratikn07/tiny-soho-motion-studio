# Tiny Soho Current Runtime State

Status: verified by read-only checks on 20 September 2026.

## Production knowledge reader

Production already contains `tiny_soho_studio_reader`. It can log in, does not have superuser, database-creation, role-creation, replication, inheritance, or BYPASSRLS privileges, and `service_role` retains BYPASSRLS.

The reader has SELECT only on `ts_techniques`, `ts_segments`, `ts_shots`, `ts_carousel_slides`, and `ts_tool_guides`. The five tables have the reader-only `tiny_soho_studio_reader_select` policy. A fresh grant check found no `anon`, `authenticated`, or PUBLIC grants on those tables. The SECURITY DEFINER function `public.rls_auto_enable()` is not executable by PUBLIC or by the reader.

No production mutation occurred during this verification. The role-creation and rollback SQL under `supabase/proposed/` are historical audit artifacts; they must not be applied to the current database.

The separate `ts_*` corpus-hardening track has a fresh read-only matrix in
[ts-corpus-security-matrix.md](./ts-corpus-security-matrix.md). It identifies
remaining public grants without authorizing their removal.

The local-only implementation and each owner-controlled canary gate are
tracked in [zero-cost-canary-status.md](./zero-cost-canary-status.md).

## Knowledge activation boundary

The checked-out repository has no local `.env` file. The application remains disabled by its committed default until an owner supplies the existing reader-specific connection URL and absolute trusted CA path through local runtime configuration. Activation requires a server-side, CA-pinned retrieval smoke against the five-table allowlist. A missing credential blocks only that activation smoke; it does not block independent local implementation work.

## Baseline

The implementation branch starts from protected `main` at `d823ff161b0ef79bbc132a6bb7c4593b7f36b754`. The local baseline passed 103 Vitest tests, `npm run check`, and `npm run build` before implementation.

## Hosted Creative Suite implementation

The Director, Workflow Studio, and CPU-safe Vision Lab implementation is
committed locally on `codex/hosted-creative-suite`. It is not yet pushed,
migrated, or deployed. The branch adds only `creative_studio_*` records and
the private `creative-studio` bucket contract; it does not modify
`insta-automation` code, infrastructure, database objects, credentials, or
runtime configuration.

Local verification for the branch includes the hosted test suite, hosted type
check and production build, Creative Worker test suite and type check, three
new isolated Vision-worker tests, and the existing 69 Vision tests in a
dependency-matched Python 3.11 environment. No Alibaba/Qwen request, Supabase
production mutation, push, Railway deployment, Vercel deployment, or model
weight download occurred.

Before release, follow
[hosted-creative-suite-release.md](./hosted-creative-suite-release.md). In
particular, a Director draft invokes Qwen after its queue claim and is not a
non-billable deployment smoke check.
