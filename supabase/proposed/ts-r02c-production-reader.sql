-- PROPOSED ONLY — TS-R02D reviewed production private-reader migration.
--
-- This file deliberately remains outside supabase/migrations. Execute it only
-- through a privileged, TLS-verified database session that binds a freshly
-- generated reader password as a parameter, for example:
--   SELECT set_config('app.tiny_soho_studio_reader_password', $1, false)
-- The password must never be copied into this file, a shell command, logs, or
-- migration history. The migration is intentionally non-idempotent: a reader
-- role that already exists is drift requiring a separate review.
--
-- It disables only the known legacy Data API access to the five reader tables.
-- It does not change service_role privileges, the external ingestion writer,
-- or the application's TINY_SOHO_KNOWLEDGE_ENABLED setting.
BEGIN;

-- Fail before changing anything unless production is still the reviewed shape.
DO $$
DECLARE
  required_tables integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
      AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Refusing migration: service_role must retain BYPASSRLS.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiny_soho_studio_reader') THEN
    RAISE EXCEPTION 'Refusing migration: tiny_soho_studio_reader already exists.';
  END IF;

  SELECT count(*)
  INTO required_tables
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname IN (
      'ts_techniques', 'ts_segments', 'ts_shots',
      'ts_carousel_slides', 'ts_tool_guides'
    );

  IF required_tables <> 5 THEN
    RAISE EXCEPTION 'Refusing migration: required Tiny Soho reader tables are missing or are not tables.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'ts_techniques', 'ts_segments', 'ts_shots',
        'ts_carousel_slides', 'ts_tool_guides'
      )
      AND NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Refusing migration: every reader table must already have RLS enabled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(relation.relacl, acldefault('r'::"char", relation.relowner)))
      AS grant_item(grantor, grantee, privilege_type, is_grantable)
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'ts_techniques', 'ts_segments', 'ts_shots',
        'ts_carousel_slides', 'ts_tool_guides'
      )
      AND grant_item.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Refusing migration: unexpected PUBLIC table privilege on a reader table.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function_row
    JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
    WHERE namespace.nspname = 'public'
      AND function_row.proname = 'rls_auto_enable'
      AND function_row.proargtypes = ''::oidvector
      AND function_row.prosecdef
  ) THEN
    RAISE EXCEPTION 'Refusing migration: expected SECURITY DEFINER public.rls_auto_enable() is not present.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS function_row
    JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(function_row.proacl, acldefault('f'::"char", function_row.proowner)))
      AS grant_item(grantor, grantee, privilege_type, is_grantable)
    WHERE namespace.nspname = 'public'
      AND function_row.prosecdef
      AND grant_item.grantee = 0
      AND grant_item.privilege_type = 'EXECUTE'
      AND NOT (
        function_row.proname = 'rls_auto_enable'
        AND function_row.proargtypes = ''::oidvector
      )
  ) THEN
    RAISE EXCEPTION 'Refusing migration: unexpected SECURITY DEFINER function exposure through PUBLIC.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy AS policy_row
    JOIN pg_class AS relation ON relation.oid = policy_row.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'ts_techniques', 'ts_segments', 'ts_shots',
        'ts_carousel_slides', 'ts_tool_guides'
      )
      AND EXISTS (
        SELECT 1
        FROM unnest(policy_row.polroles) AS policy_role(role_oid)
        WHERE policy_role.role_oid = 0
          OR EXISTS (
            SELECT 1
            FROM pg_roles
            WHERE oid = policy_role.role_oid
              AND rolname IN ('anon', 'authenticated')
          )
      )
      AND NOT (
        policy_row.polname = 'pipeline all'
        AND relation.relname IN ('ts_techniques', 'ts_segments', 'ts_shots', 'ts_tool_guides')
      )
  ) THEN
    RAISE EXCEPTION 'Refusing migration: unexpected anon/authenticated/PUBLIC policy on a reader table.';
  END IF;
END
$$;

-- Remove the reviewed legacy public-reader surface. service_role is untouched.
REVOKE ALL PRIVILEGES ON TABLE
  public.ts_techniques,
  public.ts_segments,
  public.ts_shots,
  public.ts_carousel_slides,
  public.ts_tool_guides
FROM anon, authenticated;

DROP POLICY IF EXISTS "pipeline all" ON public.ts_techniques;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_segments;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_shots;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_tool_guides;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- The secure executor must set this local session value before this migration.
DO $$
DECLARE
  reader_password text := current_setting('app.tiny_soho_studio_reader_password', true);
BEGIN
  IF reader_password IS NULL OR length(reader_password) < 32 THEN
    RAISE EXCEPTION 'A production reader password must be supplied through the session setting.';
  END IF;

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
    RAISE EXCEPTION 'tiny_soho_studio_reader must not be a member of another role.';
  END IF;

  -- PostgreSQL 16+ makes a non-superuser CREATEROLE executor an ADMIN-only,
  -- NOINHERIT/NOSET member of the role it creates. That one catalog edge does
  -- not grant the reader any privilege and is not revocable by that executor.
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS reader_role ON reader_role.oid = membership.roleid
    WHERE reader_role.rolname = 'tiny_soho_studio_reader'
      AND NOT (
        membership.member = (SELECT oid FROM pg_roles WHERE rolname = session_user)
        AND membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
      )
  ) THEN
    RAISE EXCEPTION 'tiny_soho_studio_reader has an unexpected inbound role membership.';
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM tiny_soho_studio_reader;

GRANT USAGE ON SCHEMA public TO tiny_soho_studio_reader;
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

-- Post-mutation checks prevent a partially understood ACL/function surface.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (
        'ts_techniques', 'ts_segments', 'ts_shots',
        'ts_carousel_slides', 'ts_tool_guides'
      )
      AND (
        NOT has_table_privilege('tiny_soho_studio_reader', relation.oid, 'SELECT')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'INSERT')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'UPDATE')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'DELETE')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'TRUNCATE')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'REFERENCES')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'TRIGGER')
        OR has_table_privilege('tiny_soho_studio_reader', relation.oid, 'MAINTAIN')
      )
  ) THEN
    RAISE EXCEPTION 'Reader table privileges are not SELECT-only.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname LIKE 'ts\_%' ESCAPE '\'
      AND relation.relname NOT IN (
        'ts_techniques', 'ts_segments', 'ts_shots',
        'ts_carousel_slides', 'ts_tool_guides'
      )
      AND has_table_privilege(
        'tiny_soho_studio_reader', relation.oid,
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
      )
  ) THEN
    RAISE EXCEPTION 'Reader has unexpected privilege on an unrelated ts_* table.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS function_row
    JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
    WHERE function_row.prosecdef
      AND has_schema_privilege('tiny_soho_studio_reader', namespace.oid, 'USAGE')
      AND has_function_privilege('tiny_soho_studio_reader', function_row.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Refusing migration: reader can execute an accessible SECURITY DEFINER function.';
  END IF;
END
$$;

COMMIT;
