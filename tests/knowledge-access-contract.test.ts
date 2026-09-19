import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const proposalPath = resolve(process.cwd(), "supabase/proposed/ts-r01-private-reader.sql");
const stagingBootstrapPath = resolve(process.cwd(), "supabase/staging/ts-r02c-staging-reader.sql");
const productionDraftPath = resolve(process.cwd(), "supabase/proposed/ts-r02c-production-reader.sql");
const rollbackDraftPath = resolve(process.cwd(), "supabase/proposed/ts-r02c-production-reader-rollback.sql");

describe("Tiny Soho private knowledge-reader migration proposal", () => {
  it("keeps anonymous and authenticated roles out of the knowledge read path", () => {
    const proposal = readFileSync(proposalPath, "utf8");

    expect(proposal).toContain("CREATE ROLE tiny_soho_studio_reader");
    expect(proposal).toContain("REVOKE ALL PRIVILEGES ON TABLE");
    expect(proposal).toMatch(/FROM anon, authenticated;/);
    expect(proposal).not.toMatch(/FROM\s+PUBLIC\s*;/i);
    expect(proposal).toMatch(/ALTER ROLE tiny_soho_studio_reader\s+LOGIN\s+NOSUPERUSER\s+NOCREATEDB\s+NOCREATEROLE\s+NOINHERIT\s+NOBYPASSRLS\s+NOREPLICATION\s*;/is);
    expect(proposal).not.toMatch(/PASSWORD\s+(?!NULL\b)/i);
    expect(proposal).not.toMatch(/GRANT\s+SELECT[\s\S]*?TO\s+(anon|authenticated)/i);
    expect(proposal).not.toMatch(/CREATE POLICY[\s\S]*?TO\s+(anon|authenticated)/i);
    expect(proposal).toMatch(/CREATE POLICY[\s\S]*?TO tiny_soho_studio_reader USING \(true\);/i);
  });
});

describe("Tiny Soho staging-only private reader bootstrap", () => {
  it("limits the reader role to the five approved tables and policies", () => {
    const bootstrap = readFileSync(stagingBootstrapPath, "utf8");

    expect(bootstrap).toContain("STAGING ONLY");
    expect(bootstrap).toContain("CREATE ROLE tiny_soho_studio_reader");
    expect(bootstrap).toMatch(/CREATE ROLE tiny_soho_studio_reader\s+LOGIN\s+NOSUPERUSER\s+NOCREATEDB\s+NOCREATEROLE\s+NOINHERIT\s+NOBYPASSRLS\s+NOREPLICATION\s+PASSWORD %L/is);
    expect(bootstrap).toMatch(/GRANT SELECT ON TABLE[\s\S]*?public\.ts_techniques[\s\S]*?public\.ts_segments[\s\S]*?public\.ts_shots[\s\S]*?public\.ts_carousel_slides[\s\S]*?public\.ts_tool_guides[\s\S]*?TO tiny_soho_studio_reader;/i);
    expect((bootstrap.match(/CREATE POLICY "tiny_soho_studio_reader_select"/g) || [])).toHaveLength(5);
    expect(bootstrap).not.toMatch(/TO\s+(anon|authenticated)\b/i);
    expect(bootstrap).toContain("current_setting('app.tiny_soho_studio_reader_password', true)");
    expect(bootstrap).not.toMatch(/PASSWORD\s+'[^']+'/i);
    expect(bootstrap).not.toMatch(/ALTER ROLE tiny_soho_studio_reader/i);
  });
});

describe("Tiny Soho production drafts", () => {
  it("are explicit proposals that fail closed rather than public-reader migrations", () => {
    const migration = readFileSync(productionDraftPath, "utf8");
    const rollback = readFileSync(rollbackDraftPath, "utf8");

    expect(migration).toContain("PROPOSED ONLY");
    expect(migration).toContain("tiny_soho_studio_reader");
    expect(migration).toContain("accessible SECURITY DEFINER function");
    expect(migration).not.toMatch(/TO\s+(anon|authenticated)\b/i);
    expect(migration).not.toMatch(/PASSWORD\s+'[^']+'/i);
    expect(rollback).toContain("PROPOSED ONLY");
    expect(rollback).toContain("DROP ROLE tiny_soho_studio_reader");
  });
});
