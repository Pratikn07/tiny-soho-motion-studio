-- Tiny Soho Studio only retrieves creative knowledge through the local API.
-- Preserve the separate postgres/service_role pipeline grants; remove public write access.
BEGIN;

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
TO anon;

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

CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_carousel_slides FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_edit_events FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_principle_techniques FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_principles FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_published_videos FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_recipe_techniques FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_recipes FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_reel_techniques FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_reels FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_segments FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_shots FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_slide_techniques FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_techniques FOR SELECT TO anon USING (true);
CREATE POLICY "tiny_soho_knowledge_read" ON public.ts_tool_guides FOR SELECT TO anon USING (true);

COMMIT;
