import { describe, expect, it } from "vitest";

// The runner is plain Node (runner/arena.mjs).
const arena: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/arena.mjs", import.meta.url).href);

describe("Are.na boards", () => {
  it("reads channel slugs from Are.na links and leaves other links alone", () => {
    expect(arena.arenaSlug("https://www.are.na/pratik-nandoskar/halloween-at-anaika-s")).toBe("halloween-at-anaika-s");
    expect(arena.arenaSlug("https://are.na/channel/test-iqd8ymrxdwa")).toBe("test-iqd8ymrxdwa");
    expect(arena.arenaSlug("https://www.are.na/block/123")).toBeNull();
    expect(arena.arenaSlug("https://prompt-motion.com/x4b47x-9cc84f")).toBeNull();
    expect(arena.splitReferences(["https://www.are.na/a/b", "https://savee.com/x", "https://www.are.na/a/b"]))
      .toEqual({ boards: ["b"], other: ["https://savee.com/x"] });
  });

  it("keeps up to 12 images (with link previews) and short text notes", () => {
    const image = (n: number) => ({ type: "Image", title: `pin ${n}`, image: { src: `o${n}`, medium: { src: `m${n}` } } });
    const blocks = [...Array.from({ length: 14 }, (_, n) => image(n)), { type: "Link", title: "a page", image: { src: "l" } },
      { type: "Text", content: { plain: "cosy, a little spooky" } }, { type: "Attachment", title: "pdf" }];
    const { images, notes } = arena.boardItems(blocks);
    expect(images).toHaveLength(12);
    expect(images[0]).toEqual({ src: "m0", title: "pin 0" });
    expect(notes).toEqual(["cosy, a little spooky"]);
  });

  it("reports a board it can't read instead of failing the job", async () => {
    const run = async () => { throw Object.assign(new Error("not signed in"), { code: "arena_failed" }); };
    const board = await arena.pullBoards(["private-board"], "/tmp", { run });
    expect(board.files).toEqual([]);
    expect(board.text).toContain("couldn't be read");
  });
});
