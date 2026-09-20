import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const baseMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260920154733_hosted_creative_studio.sql"), "utf8");
const catalogMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260920160000_creative_studio_full_video_catalog.sql"), "utf8");

describe("Creative Studio full-video catalog migration", () => {
  it("replaces the legacy asset MIME constraint before allowing video and audio source assets", () => {
    expect(baseMigration).toMatch(/mime_type text not null check \(mime_type in \('image\/jpeg', 'image\/png', 'image\/webp', 'video\/mp4'\)\)/);
    expect(catalogMigration).toMatch(/pg_get_constraintdef\(oid\) like '%mime_type%'/);
  });
});
