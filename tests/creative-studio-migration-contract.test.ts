import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const baseMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260920154733_hosted_creative_studio.sql"), "utf8");
const catalogMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260920160000_creative_studio_full_video_catalog.sql"), "utf8");
const suiteMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921012509_hosted_creative_suite.sql"), "utf8");

describe("Creative Studio full-video catalog migration", () => {
  it("replaces the legacy asset MIME constraint before allowing video and audio source assets", () => {
    expect(baseMigration).toMatch(/mime_type text not null check \(mime_type in \('image\/jpeg', 'image\/png', 'image\/webp', 'video\/mp4'\)\)/);
    expect(catalogMigration).toMatch(/pg_get_constraintdef\(oid\) like '%mime_type%'/);
  });

  it("establishes the dedicated private bucket when the base bucket is absent", () => {
    expect(catalogMigration).not.toMatch(/alter table storage\.buckets/i);
    expect(catalogMigration).toMatch(/insert into storage\.buckets/);
    expect(catalogMigration).toMatch(/'creative-studio',\s*'creative-studio',\s*false,\s*262144000/is);
    expect(catalogMigration).toMatch(/on conflict \(id\) do update\s+set/is);
  });

  it("adds owner-scoped creative suite queues with service-role-only claims", () => {
    expect(suiteMigration).toMatch(/create table public\.creative_studio_director_requests/i);
    expect(suiteMigration).toMatch(/create table public\.creative_studio_director_proposals/i);
    expect(suiteMigration).toMatch(/create table public\.creative_studio_workflows/i);
    expect(suiteMigration).toMatch(/create table public\.creative_studio_workflow_runs/i);
    expect(suiteMigration).toMatch(/create table public\.creative_studio_vision_jobs/i);
    expect(suiteMigration).toMatch(/create table public\.creative_studio_vision_capabilities/i);
    expect(suiteMigration).toMatch(/for update skip locked/i);
    expect(suiteMigration).toMatch(/revoke all on function public\.claim_creative_studio_vision_job\(\) from public, anon, authenticated/i);
    expect(suiteMigration).toMatch(/grant execute on function public\.claim_creative_studio_vision_job\(\) to service_role/i);
  });
});
