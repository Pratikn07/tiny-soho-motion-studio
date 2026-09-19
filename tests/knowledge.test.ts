import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredKnowledgeSource, formatDirectorEvidence, retrieveCreativeKnowledge, type KnowledgeSource } from "@/lib/knowledge";

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
    delete process.env.TINY_SOHO_SUPABASE_URL;
    delete process.env.TINY_SOHO_SUPABASE_PUBLISHABLE_KEY;
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

  it("uses only allowlisted read endpoints when configured", async () => {
    process.env.TINY_SOHO_SUPABASE_URL = "https://knowledge.example.supabase.co";
    process.env.TINY_SOHO_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await retrieveCreativeKnowledge("slow product motion", configuredKnowledgeSource());

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/knowledge\.example\.supabase\.co\/rest\/v1\/ts_(techniques|segments|shots|carousel_slides|tool_guides)\?/);
      expect(init).toMatchObject({ headers: { apikey: "test-publishable-key", Authorization: "Bearer test-publishable-key" } });
    }
  });

  it("refuses a service_role credential or non-Supabase host", () => {
    process.env.TINY_SOHO_SUPABASE_URL = "https://not-supabase.example";
    process.env.TINY_SOHO_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    expect(configuredKnowledgeSource()).toBeNull();

    process.env.TINY_SOHO_SUPABASE_URL = "https://knowledge.example.supabase.co";
    process.env.TINY_SOHO_SUPABASE_PUBLISHABLE_KEY = "sb_secret_test";
    expect(configuredKnowledgeSource()).toBeNull();
  });
});
