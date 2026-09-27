import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/session/route";
import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("Studio session route", () => {
  it("checks ownership and returns a non-cacheable response without identity data", async () => {
    vi.mocked(requireOwner).mockResolvedValue({ userId: "owner-id", email: "owner@example.test" });
    const request = new Request("https://studio.test/api/session");
    const response = await GET(request);
    expect(requireOwner).toHaveBeenCalledWith(request);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });
  it.each([401, 403])("preserves the owner gate's %s response", async (status) => {
    vi.mocked(requireOwner).mockRejectedValue(new StudioError(status, "denied", "Access denied"));
    const response = await GET(new Request("https://studio.test/api/session"));
    expect(response.status).toBe(status);
  });
});
