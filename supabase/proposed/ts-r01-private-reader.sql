-- PROPOSED ONLY — TS-R01 privacy decision. Do not run or move this file into
-- supabase/migrations until the user explicitly approves this exact change.
--
-- Prerequisites for TS-R02:
--   1. Confirm every active ingestion writer uses postgres or service_role.
--   2. Add a password for tiny_soho_studio_reader outside source control.
--   3. Implement the local server-only direct Postgres reader and test it in staging.
--
-- This proposal intentionally leaves postgres and service_role writer grants intact.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiny_soho_studio_reader') THEN
    CREATE ROLE tiny_soho_studio_reader
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS
      NOREPLICATION
      PASSWORD NULL;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tiny_soho_studio_reader;

REVOKE ALL PRIVILEGES ON TABLE
  public.ts_carousel_slides,
  public.ts_edit_events,
  public.ts_principle_techniques,
  public.ts_principles,
  public.ts_published_videos,
  public.ts_recipe_techniques,
  public.ts_recipes,
  public.ts_reel_techniques,
  public.ts_reels,
  public.ts_segments,
  public.ts_shots,
  public.ts_slide_techniques,
  public.ts_techniques,
  public.ts_tool_guides
FROM PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE
  public.ts_carousel_slides,
  public.ts_edit_events,
  public.ts_principle_techniques,
  public.ts_principles,
  public.ts_published_videos,
  public.ts_recipe_techniques,
  public.ts_recipes,
  public.ts_reel_techniques,
  public.ts_reels,
  public.ts_segments,
  public.ts_shots,
  public.ts_slide_techniques,
  public.ts_techniques,
  public.ts_tool_guides
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.ts_carousel_slides,
  public.ts_segments,
  public.ts_shots,
  public.ts_techniques,
  public.ts_tool_guides
TO tiny_soho_studio_reader;

DROP POLICY IF EXISTS "pipeline all" ON public.ts_carousel_slides;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_edit_events;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_principle_techniques;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_principles;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_published_videos;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_recipe_techniques;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_recipes;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_reel_techniques;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_reels;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_segments;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_shots;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_slide_techniques;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_techniques;
DROP POLICY IF EXISTS "pipeline all" ON public.ts_tool_guides;

DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_carousel_slides;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_edit_events;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_principle_techniques;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_principles;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_published_videos;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_recipe_techniques;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_recipes;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_reel_techniques;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_reels;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_segments;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_shots;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_slide_techniques;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_techniques;
DROP POLICY IF EXISTS "tiny_soho_knowledge_read" ON public.ts_tool_guides;

CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_carousel_slides
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_segments
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_shots
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_techniques
  FOR SELECT TO tiny_soho_studio_reader USING (true);
CREATE POLICY "tiny_soho_studio_reader_select" ON public.ts_tool_guides
  FOR SELECT TO tiny_soho_studio_reader USING (true);

COMMIT;
