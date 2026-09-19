-- STAGING ONLY — TS-R02C private Tiny Soho knowledge-reader validation.
--
-- This is not a production migration and contains no production data or
-- credentials. The caller must set app.tiny_soho_studio_reader_password in
-- its current database session before running this file; that value is never
-- persisted in this repository.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ts_reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.ts_techniques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  layer text NOT NULL,
  category text,
  mechanism text NOT NULL,
  example text,
  why_it_works text,
  parent_technique_id uuid REFERENCES public.ts_techniques(id),
  combines_well_with uuid[] NOT NULL DEFAULT '{}',
  production_cost text,
  production_notes text,
  tinysoho_use_cases text[],
  confidence numeric NOT NULL DEFAULT 0.5,
  times_used integer NOT NULL DEFAULT 0,
  avg_performance_lift numeric,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  evidence_type text NOT NULL DEFAULT 'observed' CHECK (evidence_type IN ('observed', 'inferred', 'hypothesis')),
  prompt_fragment text
);

CREATE TABLE IF NOT EXISTS public.ts_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.ts_reels(id) ON DELETE CASCADE,
  beat_index integer NOT NULL,
  start_s numeric NOT NULL,
  end_s numeric NOT NULL,
  narrative_role text,
  spoken_text text,
  visual_description text,
  onscreen_text text,
  person_action text,
  camera_movement text,
  audio_description text,
  transition_out text,
  technique_notes text,
  why_it_works text,
  tinysoho_adaptation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  evidence_type text NOT NULL DEFAULT 'observed' CHECK (evidence_type IN ('observed', 'inferred', 'hypothesis')),
  UNIQUE (reel_id, beat_index)
);

CREATE TABLE IF NOT EXISTS public.ts_shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.ts_reels(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES public.ts_segments(id) ON DELETE CASCADE,
  start_s numeric NOT NULL,
  end_s numeric NOT NULL,
  shot_type text,
  action text,
  framing_notes text,
  evidence_type text NOT NULL DEFAULT 'observed' CHECK (evidence_type IN ('observed', 'inferred', 'hypothesis')),
  confidence numeric CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ts_carousel_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.ts_reels(id) ON DELETE CASCADE,
  slide_index integer NOT NULL CHECK (slide_index >= 1),
  slide_role text NOT NULL DEFAULT 'value' CHECK (slide_role IN ('hook', 'value', 'proof', 'objection', 'story', 'cta', 'closer', 'cover', 'transition')),
  transcribed_text text,
  visual_description text,
  layout_notes text,
  typography_notes text,
  color_notes text,
  swipe_prompt text,
  evidence_type text NOT NULL DEFAULT 'observed' CHECK (evidence_type IN ('observed', 'inferred', 'hypothesis')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reel_id, slide_index)
);

CREATE TABLE IF NOT EXISTS public.ts_tool_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid REFERENCES public.ts_reels(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  topic text NOT NULL,
  summary text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_templates text[] NOT NULL DEFAULT '{}',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_type text NOT NULL DEFAULT 'observed' CHECK (evidence_type IN ('observed', 'inferred', 'hypothesis')),
  confidence numeric CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ts_techniques_layer_idx ON public.ts_techniques (layer);
CREATE INDEX IF NOT EXISTS ts_techniques_status_idx ON public.ts_techniques (status);
CREATE INDEX IF NOT EXISTS ts_segments_reel_idx ON public.ts_segments (reel_id);
CREATE INDEX IF NOT EXISTS ts_shots_reel_idx ON public.ts_shots (reel_id);
CREATE INDEX IF NOT EXISTS ts_shots_segment_idx ON public.ts_shots (segment_id);
CREATE INDEX IF NOT EXISTS idx_carousel_slides_reel ON public.ts_carousel_slides (reel_id);
CREATE INDEX IF NOT EXISTS ts_tool_guides_tool_idx ON public.ts_tool_guides (tool_name);

ALTER TABLE public.ts_reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_techniques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_carousel_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_tool_guides ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  reader_password text := current_setting('app.tiny_soho_studio_reader_password', true);
BEGIN
  IF reader_password IS NULL OR length(reader_password) < 32 THEN
    RAISE EXCEPTION 'A staging reader password must be provided through the session setting.';
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

REVOKE ALL PRIVILEGES ON DATABASE postgres FROM tiny_soho_studio_reader;
GRANT CONNECT ON DATABASE postgres TO tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM tiny_soho_studio_reader;
GRANT USAGE ON SCHEMA public TO tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM tiny_soho_studio_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM tiny_soho_studio_reader;

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

-- Synthetic staging-only fixture: validates the application adapter without
-- copying any proprietary production knowledge.
INSERT INTO public.ts_techniques (name, layer, category, mechanism, why_it_works, prompt_fragment, confidence, times_used, status)
VALUES (
  'Staging slow push-in',
  'camera',
  'product',
  'Gradually move closer to the subject',
  'Maintains focus while typography remains local',
  'slow, stable push-in',
  0.9,
  1,
  'proven'
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
