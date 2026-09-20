# Tiny Soho corpus access matrix

Status: read-only production snapshot on 20 September 2026.

This is an evidence record, not authorization to change Supabase. The five
Tiny Soho Studio reader tables are deliberately isolated. The remaining corpus
tables require writer-impact discovery before any least-privilege migration or
rollback can be drafted or applied.

| Table group | RLS | `anon` / `authenticated` SELECT | Policy state |
| --- | --- | --- | --- |
| `ts_techniques`, `ts_segments`, `ts_shots`, `ts_carousel_slides`, `ts_tool_guides` | enabled | no | `tiny_soho_studio_reader_select` only |
| `ts_edit_events`, `ts_principle_techniques`, `ts_principles`, `ts_published_videos`, `ts_recipe_techniques`, `ts_recipes`, `ts_reel_techniques`, `ts_reels` | enabled | yes | `pipeline all` applies to `public` |
| `ts_slide_techniques` | enabled | yes | no policy currently recorded |

`service_role` retains SELECT on every listed table. The isolated reader role
has SELECT only on the five reader tables and is not to be widened as part of
this corpus-hardening track.

## Required before any change

1. Identify the external ingestion/writer for every table with broad grants or
   a public policy, including its exact required operations.
2. Validate a table-specific least-privilege migration and rollback on staging
   with that writer.
3. Obtain explicit production authorization for the exact tables and policy
   changes.
4. Run security advisors after approved DDL and record unrelated findings
   separately.

No table grants, policies, roles, reader credentials, or production data were
changed to produce this snapshot.
