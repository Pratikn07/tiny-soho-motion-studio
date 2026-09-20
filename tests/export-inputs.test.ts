import { describe, expect, it } from "vitest";
import { validateExportInputs } from "@/lib/export-inputs";
import { createStore } from "@/lib/store";

describe("export input ownership", () => {
  it("requires the target project and rejects a media asset from another project", () => {
    const db = createStore(":memory:");
    try {
      const target = db.createProject("Target");
      const another = db.createProject("Another");
      const foreignVideo = db.addAsset({ projectId: another.id, kind: "video", name: "foreign.mp4", mime: "video/mp4", path: "/tmp/foreign.mp4", width: 10, height: 10, duration: 1, hash: "foreign", provenance: "{}" });

      expect(() => validateExportInputs(db, target.id, [foreignVideo.id])).toThrow(/same project/i);
      expect(() => validateExportInputs(db, "project_missing", [foreignVideo.id])).toThrow(/Project not found/i);
    } finally {
      db.close();
    }
  });

  it("allows project-scoped and explicit global media while enforcing overlay ownership", () => {
    const db = createStore(":memory:");
    try {
      const target = db.createProject("Target");
      const another = db.createProject("Another");
      const ownVideo = db.addAsset({ projectId: target.id, kind: "video", name: "own.mp4", mime: "video/mp4", path: "/tmp/own.mp4", width: 10, height: 10, duration: 1, hash: "own", provenance: "{}" });
      const globalVideo = db.addAsset({ projectId: null, kind: "video", name: "global.mp4", mime: "video/mp4", path: "/tmp/global.mp4", width: 10, height: 10, duration: 1, hash: "global", provenance: "{}" });
      const foreignOverlay = db.addAsset({ projectId: another.id, kind: "overlay", name: "foreign.png", mime: "image/png", path: "/tmp/foreign.png", width: 10, height: 10, duration: null, hash: "foreign-overlay", provenance: "{}" });

      expect(validateExportInputs(db, target.id, [ownVideo.id, globalVideo.id]).videos).toHaveLength(2);
      expect(() => validateExportInputs(db, target.id, [ownVideo.id], foreignOverlay.id)).toThrow(/same project/i);
    } finally {
      db.close();
    }
  });
});
