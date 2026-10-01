import { describe, expect, it } from "vitest";

import { backgroundOnly, describeFile, pairFiles, ratioLabel } from "@/components/creation/upload/pairing";

const file = (name: string, type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg", size = 2048) =>
  new File([new Uint8Array(size)], name, { type });

describe("pairing dropped files by name", () => {
  it("pairs 20 files into 10 slides in natural order, whatever order they were dropped in", () => {
    const files = Array.from({ length: 10 }, (_, index) => {
      const n = index + 1;
      return [file(`slide ${n}-background.jpg`), file(`slide ${n}-text.png`)];
    }).flat().reverse();
    const { pairs, unpaired, rejected } = pairFiles(files);
    expect(unpaired).toEqual([]);
    expect(rejected).toEqual([]);
    expect(pairs.map((pair) => pair.name)).toEqual(Array.from({ length: 10 }, (_, index) => `slide ${index + 1}`));
    for (const pair of pairs) {
      expect(pair.background.name).toBe(`${pair.name}-background.jpg`);
      expect(pair.text?.name).toBe(`${pair.name}-text.png`);
    }
  });

  it("accepts -bg/-txt and _background/_text in any letter case", () => {
    const { pairs } = pairFiles([
      file("Potty_Background.webp"), file("potty_TEXT.png"),
      file("meal-prep-bg.jpg"), file("Meal-Prep-txt.png"),
      file("salmon cakes.background.png"), file("salmon cakes.text.png"),
    ]);
    expect(pairs.map((pair) => [pair.name, pair.background.name, pair.text?.name])).toEqual([
      ["meal-prep", "meal-prep-bg.jpg", "Meal-Prep-txt.png"],
      ["Potty", "Potty_Background.webp", "potty_TEXT.png"],
      ["salmon cakes", "salmon cakes.background.png", "salmon cakes.text.png"],
    ]);
  });

  it("explains every file that needs a partner", () => {
    const { pairs, unpaired } = pairFiles([
      file("lonely-background.jpg"),
      file("orphan-text.png"),
      file("cover.png"),
      file("twin-background.jpg"), file("twin-bg.png"), file("twin-text.png"),
      file("jpg-text-background.png"), file("jpg-text-text.jpg"),
    ]);
    expect(pairs).toEqual([]);
    const reasons = Object.fromEntries(unpaired.map((item) => [item.file.name, [item.role, item.reason]]));
    expect(reasons["lonely-background.jpg"]).toEqual(["background", "No text layer has the same name."]);
    expect(reasons["orphan-text.png"]).toEqual(["text", "No background has the same name."]);
    expect(reasons["cover.png"][0]).toBe("unknown");
    expect(reasons["twin-background.jpg"][1]).toMatch(/More than one background/);
    expect(reasons["jpg-text-text.jpg"]).toEqual(["text", "Text layers must be PNG files with transparency."]);
    expect(reasons["jpg-text-background.png"][1]).toMatch(/isn't a PNG/);
  });

  it("rejects files the upload can't take", () => {
    const { rejected } = pairFiles([
      file("notes-background.gif", "image/gif"),
      file("big-background.jpg", "image/jpeg", 26 * 1024 * 1024),
      file("empty-background.jpg", "image/jpeg", 0),
    ]);
    expect(rejected.map((item) => item.reason)).toEqual([
      "Use a PNG, JPG or WebP file.", "This file is larger than 25 MB.", "This file is empty.",
    ]);
  });

  it("reads names and ratios the way the creator sees them", () => {
    expect(describeFile("Slide 3 - background.jpg")).toEqual({ stem: "Slide 3", role: "background" });
    expect(describeFile("background.jpg")).toEqual({ stem: "background", role: "unknown" });
    expect(backgroundOnly(file("cover-background.jpg"))).toMatchObject({ name: "cover", text: null });
    expect(ratioLabel(1122, 1402)).toBe("4:5");
    expect(ratioLabel(1080, 1920)).toBe("9:16");
    expect(ratioLabel(1080, 1080)).toBe("1:1");
    expect(ratioLabel(1000, 1300)).toBe("1000×1300");
  });
});
