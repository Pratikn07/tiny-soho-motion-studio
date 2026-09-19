-- PROPOSED ONLY — TS-R02C production private-reader migration draft.
--
-- DO NOT move this file into supabase/migrations or execute it without a
-- separate production approval. Before running it in one privileged database
-- session, provide the generated reader password through:
--   SELECT set_config('app.tiny_soho_studio_reader_password', $1, false)
-- where $1 is supplied by the secure executor, not source control or logs.
--
-- This draft does not alter the external ingestion writer, re-enable the old
-- Supabase Data API reader, grant access to anonymous/authenticated roles, or
-- add a service-role fallback.
BEGIN;

DO $$
DECLARE
  reader_password text := current_setting('app.tiny_soho_studio_reader_password', true);
BEGIN
  IF reader_password IS NULL OR length(reader_password) < 32 THEN
    RAISE EXCEPTION 'A production reader password must be supplied through the session setting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiny_soho_studio_reader') THEN
    EXECUTE format(
      'CREATE ROLE tiny_soho_studio_reader
        LOGIN
        NOSUPERUSER
        NOCREATEDB
        NOCREATEROLE
        NOINHERIT
        NOBYPASSRLS
        NOREPLICATION
        PASSWORD %L',
      reader_password
    );
  END IF;
END
$$;

DO $$
DECLARE
  reader_attributes record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
  INTO reader_attributes
  FROM pg_roles
  WHERE rolname = 'tiny_soho_studio_reader';

  IF reader_attributes.rolcanlogin IS DISTINCT FROM true
    OR reader_attributes.rolsuper IS DISTINCT FROM false
    OR reader_attributes.rolcreatedb IS DISTINCT FROM false
    OR reader_attributes.rolcreaterole IS DISTINCT FROM false
    OR reader_attributes.rolinherit IS DISTINCT FROM false
    OR reader_attributes.rolbypassrls IS DISTINCT FROM false
    OR reader_attributes.rolreplication IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'tiny_soho_studio_reader has unexpected role attributes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = 'tiny_soho_studio_reader'
  ) THEN
    RAISE EXCEPTION 'tiny_soho_studio_reader must not have role memberships.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('ts_techniques', 'ts_segments', 'ts_shots', 'ts_carousel_slides', 'ts_tool_guides')
      AND relation.relkind = 'r'
      AND (has_table_privilege('anon', relation.oid, 'SELECT') OR has_table_privilege('authenticated', relation.oid, 'SELECT'))
  ) THEN
    RAISE EXCEPTION 'Refusing to create a private reader while a public API role has SELECT access.';
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM tiny_soho_studio_reader;
GRANT USAGE ON SCHEMA public TO tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM tiny_soho_studio_reader;

ALTER TABLE public.ts_techniques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_carousel_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_tool_guides ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE
  public.ts_techniques,
  public.ts_segments,
  public.ts_shots,
  public.ts_carousel_slides,
  public.ts_tool_guides
TO tiny_soho_studio_reader;

DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_techniques;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_segments;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_shots;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_carousel_slides;
DROP POLICY IF EXISTS "tiny_soho_studio_reader_select" ON public.ts_tool_guides;

CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_techniques
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_segments
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_shots
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_carousel_slides
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_tool_guides
  FOR SELECT TO tiny_soho_studio_reader USING (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS function_row
    JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
    WHERE function_row.prosecdef
      AND has_schema_privilege('tiny_soho_studio_reader', namespace.oid, 'USAGE')
      AND has_function_privilege('tiny_soho_studio_reader', function_row.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Refusing to enable reader: an accessible SECURITY DEFINER function exists.';
  END IF;
END
$$;

COMMIT;
