-- PROPOSED ONLY — TS-R02C production private-reader rollback draft.
--
-- DO NOT execute without a separate production approval. First set
-- TINY_SOHO_KNOWLEDGE_ENABLED=false everywhere and verify that no application
-- process is connected as tiny_soho_studio_reader. This revokes the dedicated
-- reader only; it deliberately does not restore any legacy Supabase reader.
BEGIN;

DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_techniques;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_segments;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_shots;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_carousel_slides;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_tool_guides;

REVOKE SELECT ON TABLE
  public.ts_techniques,
  public.ts_segments,
  public.ts_shots,
  public.ts_carousel_slides,
  public.ts_tool_guides
FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM tiny_soho_studio_reader;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_stat_activity
    WHERE usename = 'tiny_soho_studio_reader'
      AND pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'Reader sessions are still active; do not drop the role yet.';
  END IF;
END
$$;

DROP ROLE tiny_soho_studio_reader;

COMMIT;
