import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const proposalPath = resolve(process.cwd(), "supabase/proposed/ts-r01-private-reader.sql");

describe("Tiny Soho private knowledge-reader migration proposal", () => {
  it("keeps anonymous and authenticated roles out of the knowledge read path", () => {
    const proposal = readFileSync(proposalPath, "utf8");

    expect(proposal).toContain("CREATE ROLE tiny_soho_studio_reader");
    expect(proposal).toContain("REVOKE ALL PRIVILEGES ON TABLE");
    expect(proposal).toMatch(/FROM anon, authenticated;/);
    expect(proposal).not.toMatch(/GRANT\s+SELECT[\s\S]*?TO\s+(anon|authenticated)/i);
    expect(proposal).not.toMatch(/CREATE POLICY[\s\S]*?TO\s+(anon|authenticated)/i);
    expect(proposal).toMatch(/CREATE POLICY[\s\S]*?TO tiny_soho_studio_reader USING \(true\);/i);
  });
});
