import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { configuredKnowledgeSource, formatDirectorEvidence, knowledgeConfigured, retrieveCreativeKnowledge, type KnowledgeSource } from "@/lib/knowledge";

const testCertificatePath = resolve(process.cwd(), "tests/fixtures/supabase-ca.txt");

const postgres = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const end = vi.fn(async () => undefined);
  const Pool = vi.fn(function Pool() { return { connect, end }; });
  return { query, release, connect, end, Pool };
});

vi.mock("pg", () => ({ Pool: postgres.Pool }));

const source: KnowledgeSource = {
  async searchTechniques() {
    return [
      { id: "technique-push", name: "Slow push-in", layer: "camera", category: "product", mechanism: "Gradually move closer to the product", example: "A subtle push toward a skincare bottle", why_it_works: "Builds focus without disrupting stationary typography", confidence: 0.94, times_used: 12, prompt_fragment: "slow, stable push-in toward the product", status: "proven" },
      { id: "technique-unrelated", name: "Jump cut", layer: "editing", category: "comedy", mechanism: "Abrupt edit", example: "A reaction cut", why_it_works: "Creates surprise", confidence: 0.99, times_used: 80, prompt_fragment: "jump cut", status: "proven" },
    ];
  },
  async searchSegments() { return []; },
  async searchShots() { return []; },
  async searchCarouselSlides() { return []; },
  async searchToolGuides() { return []; },
};

describe("creative knowledge retrieval", () => {
  afterEach(() => {
    delete process.env.TINY_SOHO_KNOWLEDGE_ENABLED;
    delete process.env.TINY_SOHO_KNOWLEDGE_DATABASE_URL;
    delete process.env.TINY_SOHO_KNOWLEDGE_DATABASE_CA_PATH;
    delete process.env.TINY_SOHO_SUPABASE_URL;
    delete process.env.TINY_SOHO_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.TINY_SOHO_SUPABASE_SERVICE_ROLE_KEY;
    postgres.query.mockReset();
    postgres.connect.mockClear();
    postgres.release.mockReset();
    postgres.end.mockReset();
    postgres.Pool.mockClear();
    vi.unstubAllGlobals();
  });

  it("returns deterministic, attributable evidence ranked for the brief", async () => {
    const result = await retrieveCreativeKnowledge("Create a slow product push-in with text-safe space.", source);

    expect(result.status).toBe("available");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ source: "technique", sourceId: "technique-push", title: "Slow push-in" });
    expect(result.evidence[0].score).toBeGreaterThan(0);
    expect(formatDirectorEvidence(result.evidence)).toContain("[technique:technique-push]");
  });

  it("reports no matching evidence instead of returning unrelated records", async () => {
    const result = await retrieveCreativeKnowledge("Use a hand-drawn claymation dragon.", source);

    expect(result).toMatchObject({ status: "no-match", evidence: [] });
  });

  it("keeps unavailable knowledge distinct from an empty search result", async () => {
    const result = await retrieveCreativeKnowledge("A slow product push-in", null);

    expect(result).toMatchObject({ status: "not-configured", evidence: [] });
  });

  it("legacy Supabase environment variables cannot reactivate knowledge retrieval", () => {
    process.env.TINY_SOHO_SUPABASE_URL = "https://knowledge.example.supabase.co";
    process.env.TINY_SOHO_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    process.env.TINY_SOHO_SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

    expect(configuredKnowledgeSource()).toBeNull();
    expect(knowledgeConfigured()).toBe(false);
  });

  it("activates only with the explicit private-reader flag and a direct Postgres URL", () => {
    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_URL = "postgresql://tiny_soho_studio_reader:reader-password@staging.example.com:5432/postgres";

    expect(configuredKnowledgeSource()).toBeNull();
    expect(knowledgeConfigured()).toBe(false);

    process.env.TINY_SOHO_KNOWLEDGE_ENABLED = "true";

    expect(configuredKnowledgeSource()).toBeNull();
    expect(knowledgeConfigured()).toBe(false);

    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_CA_PATH = testCertificatePath;

    expect(configuredKnowledgeSource()).not.toBeNull();
    expect(knowledgeConfigured()).toBe(true);
  });

  it("fails closed when the private reader configuration is missing or malformed", () => {
    process.env.TINY_SOHO_KNOWLEDGE_ENABLED = "true";
    expect(configuredKnowledgeSource()).toBeNull();

    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_URL = "https://not-a-postgres-connection.example.com";
    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_CA_PATH = testCertificatePath;
    expect(configuredKnowledgeSource()).toBeNull();
    expect(knowledgeConfigured()).toBe(false);

    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_URL = "postgresql://tiny_soho_studio_reader:reader-password@staging.example.com:5432/postgres?sslmode=require";
    expect(configuredKnowledgeSource()).toBeNull();
  });

  it("queries only the allowlisted tables with bound terms inside a read-only transaction", async () => {
    process.env.TINY_SOHO_KNOWLEDGE_ENABLED = "true";
    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_URL = "postgresql://tiny_soho_studio_reader:reader-password@staging.example.com:5432/postgres";
    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_CA_PATH = testCertificatePath;
    postgres.query.mockImplementation(async (query: string) => {
      if (query.includes("FROM public.ts_techniques")) {
        return { rows: [{ id: "technique-push", name: "Slow push-in", category: "product", mechanism: "Gradually move closer", why_it_works: "Builds focus", prompt_fragment: "slow push-in", confidence: 0.9, times_used: 2 }] };
      }
      return { rows: [] };
    });

    const result = await retrieveCreativeKnowledge("Slow product push-in");

    expect(result).toMatchObject({ status: "available", evidence: [{ source: "technique", sourceId: "technique-push" }] });
    expect(postgres.Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 2, connectionTimeoutMillis: 3_000 }));
    expect(postgres.query).toHaveBeenCalledWith("BEGIN TRANSACTION READ ONLY");
    expect(postgres.query).toHaveBeenCalledWith("SELECT set_config('statement_timeout', $1, true)", ["3000"]);

    const selects = postgres.query.mock.calls.filter((call) => typeof call[0] === "string" && call[0].startsWith("SELECT") && call[0].includes("FROM public.ts_"));
    expect(selects).toHaveLength(5);
    expect(new Set(selects.map((call) => (call[0] as string).match(/FROM public\.(ts_[a-z_]+)/)?.[1]))).toEqual(new Set([
      "ts_techniques", "ts_segments", "ts_shots", "ts_carousel_slides", "ts_tool_guides",
    ]));
    expect(selects.every((call) => {
      const values = call[1];
      return Array.isArray(values) && values.length === 1 && Array.isArray(values[0]) && values[0].every((value) => typeof value === "string" && value.startsWith("%") && value.endsWith("%"));
    })).toBe(true);
    expect(postgres.query.mock.calls.some((call) => typeof call[0] === "string" && /set role|security definer|rpc/i.test(call[0]))).toBe(false);
  });

  it("converts database failure and malformed database rows into safe retrieval outcomes", async () => {
    process.env.TINY_SOHO_KNOWLEDGE_ENABLED = "true";
    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_URL = "postgresql://tiny_soho_studio_reader:reader-password@staging.example.com:5432/postgres";
    process.env.TINY_SOHO_KNOWLEDGE_DATABASE_CA_PATH = testCertificatePath;
    postgres.query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(retrieveCreativeKnowledge("Slow product push-in")).resolves.toMatchObject({ status: "unavailable", evidence: [] });

    postgres.query.mockImplementation(async (query: string) => query.includes("FROM public.ts_techniques")
      ? { rows: [{ id: "malformed", name: 42, mechanism: null }] }
      : { rows: [] });

    await expect(retrieveCreativeKnowledge("Slow product push-in")).resolves.toMatchObject({ status: "no-match", evidence: [] });
  });
});
