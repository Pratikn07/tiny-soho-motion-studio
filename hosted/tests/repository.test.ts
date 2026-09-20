import { describe, expect, it, vi } from "vitest";
import { StudioRepository, projectFilter, visibleAsset } from "@/lib/repository";

describe("hosted Studio repository ownership", () => {
  it("builds a project filter bound to the authenticated owner", () => {
    expect(projectFilter("owner-a")).toEqual({ owner_user_id: "owner-a" });
  });

  it("does not expose an asset belonging to another owner", () => {
    expect(
      visibleAsset({ id: "asset-a", owner_user_id: "owner-a" }, "owner-b"),
    ).toBeNull();
  });

  it("includes the owner predicate when reading a project by ID", async () => {
    const eq = vi.fn();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "project-a", owner_user_id: "owner-a", name: "Campaign" },
      error: null,
    });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: eq.mockReturnThis(),
      maybeSingle,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );

    await expect(repository.getProject("project-a")).resolves.toMatchObject({ id: "project-a" });
    expect(eq).toHaveBeenCalledWith("id", "project-a");
    expect(eq).toHaveBeenCalledWith("owner_user_id", "owner-a");
  });

  it("assigns the authenticated owner when creating a project", async () => {
    const insert = vi.fn();
    const single = vi.fn().mockResolvedValue({
      data: { id: "project-a", owner_user_id: "owner-a", name: "Campaign" },
      error: null,
    });
    const query = {
      insert: insert.mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );

    await repository.createProject({ name: "Campaign", canvas: "1080x1920" });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_user_id: "owner-a",
      name: "Campaign",
      canvas: "1080x1920",
    }));
  });

  it("assigns the authenticated owner when recording an uploaded asset", async () => {
    const insert = vi.fn();
    const single = vi.fn().mockResolvedValue({
      data: { id: "asset-a", owner_user_id: "owner-a", project_id: "project-a" },
      error: null,
    });
    const query = {
      insert: insert.mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single,
    };
    const repository = new StudioRepository(
      { from: vi.fn().mockReturnValue(query) },
      { userId: "owner-a", email: "owner@tinysoho.test" },
    );

    await repository.createAsset({
      id: "asset-a",
      projectId: "project-a",
      kind: "source-image",
      name: "Frame.png",
      mimeType: "image/png",
      objectPath: "owners/owner-a/projects/project-a/sources/asset-a-Frame.png",
      byteSize: 12,
      width: 1,
      height: 1,
      sha256: "a".repeat(64),
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: "asset-a",
      owner_user_id: "owner-a",
      project_id: "project-a",
    }));
  });
});
