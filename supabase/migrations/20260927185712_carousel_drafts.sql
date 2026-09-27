-- Existing owner-gated project table remains RLS-enabled and service-only.
alter table public.creative_studio_projects
  add column carousel_document jsonb,
  add column carousel_revision integer not null default 0 check (carousel_revision >= 0),
  add constraint carousel_document_object check (carousel_document is null or jsonb_typeof(carousel_document) = 'object');
