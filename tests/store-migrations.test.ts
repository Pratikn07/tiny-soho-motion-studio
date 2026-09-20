import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "@/lib/store";

describe("SQLite schema migrations", () => {
  it("recognizes the current schema as baseline version 1 without rebuilding it", () => {
    const db = createStore(":memory:");
    try {
      expect(db.schemaVersion()).toBe(1);
      expect(db.createProject("Migration fixture").name).toBe("Migration fixture");
    } finally {
      db.close();
    }
  });

  it("marks an existing baseline database without rebuilding or discarding its rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tiny-soho-migration-"));
    const filename = path.join(directory, "studio.sqlite");
    const legacy = new Database(filename);
    legacy.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, canvas TEXT NOT NULL, storyboard TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);");
    legacy.prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)").run("project_legacy", "Legacy", "1080x1440", "[]", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    legacy.close();

    const db = createStore(filename);
    try {
      expect(db.schemaVersion()).toBe(1);
      expect(db.getProject("project_legacy")?.name).toBe("Legacy");
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
