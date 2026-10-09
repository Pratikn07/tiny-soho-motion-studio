import { describe, expect, it } from "vitest";

// The runner is plain Node (runner/arena.mjs).
const arena: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/arena.mjs", import.meta.url).href);
const keeper: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/arena-board.mjs", import.meta.url).href);

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

  it("puts this reel's pins first on the board Studio keeps; a standalone reel reads only its own", () => {
    const pin = (id: number, tag: string | null, at: string) => ({ id, type: "Image", connection: { metadata: tag ? { studio_reel: tag } : null, connected_at: at } });
    const blocks = [pin(1, "old", "2026-10-01"), pin(2, "abc", "2026-10-02"), pin(3, null, "2026-10-05"), pin(4, "abc", "2026-10-03")];
    expect(arena.preferred(blocks, { tag: "abc" }).map((b: any) => b.id)).toEqual([4, 2, 3, 1]);
    expect(arena.preferred(blocks, { tag: "abc", only: true }).map((b: any) => b.id)).toEqual([4, 2]);
  });
});

describe("the Are.na board Studio keeps", () => {
  it("names one board per series and one for standalone reels", () => {
    expect(keeper.boardFor("Halloween")).toEqual({ title: "Tiny Soho · Halloween", standalone: false, series: "Halloween" });
    expect(keeper.boardFor("standalone").title).toBe("Tiny Soho · Standalone");
    expect(keeper.boardFor(null).standalone).toBe(true);
    expect(keeper.reelTag("3f2a9c1e-77aa-4b1c-9d00-123456789abc")).toBe("3f2a9c1e");
  });

  it("finds the board on the account, or creates it private", async () => {
    const calls: string[][] = [];
    const reply = (channels: unknown[]) => async (_cmd: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "whoami") return { stdout: JSON.stringify({ slug: "me" }) };
      if (args[0] === "user") return { stdout: JSON.stringify({ data: channels }) };
      return { stdout: JSON.stringify({ slug: "tiny-soho-halloween-x1" }) };
    };
    const board = keeper.boardFor("Halloween");
    expect(await keeper.findOrCreateBoard(board, { run: reply([{ title: "tiny soho · halloween", slug: "found-1" }]) }))
      .toMatchObject({ slug: "found-1", url: "https://www.are.na/me/found-1", created: false });
    expect(calls.some((args) => args[0] === "channel")).toBe(false);
    expect(await keeper.findOrCreateBoard(board, { run: reply([]) })).toMatchObject({ slug: "tiny-soho-halloween-x1", created: true });
    expect(calls.at(-1)).toEqual(expect.arrayContaining(["channel", "create", "Tiny Soho · Halloween", "--visibility", "private"]));
  });

  it("keeps image pins with their reel tag, and only good public channels from search", () => {
    const pins = keeper.imagePins([
      { id: 1, type: "Image", title: "riso", image: { small: { src: "s1" } }, connection: { metadata: { studio_reel: "abc" }, connected_at: "t" } },
      { id: 2, type: "Link", image: { small: { src: "s2" } } }, { id: 3, type: "Image" },
    ]);
    expect(pins).toEqual([{ id: 1, src: "s1", title: "riso", tag: "abc", at: "t" }]);
    expect(keeper.goodChannels([
      { slug: "a", status: "public", length: 40, user: { slug: "x" } }, { slug: "b", status: "private", length: 40 },
      { slug: "c", status: "closed", length: 9 }, { slug: "d", status: "closed", length: 90, user: { slug: "me" } },
    ], "me")).toEqual(["a"]);
  });

  it("reads Claude's search terms and picks, with a fallback from the brief", () => {
    expect(keeper.parseQueries('["Risograph", "paper collage", "riso orange blue", "paper collage"]')).toEqual(["risograph", "paper collage"]);
    expect(keeper.fallbackQueries({ series: "Halloween", brief: { treatment: "cut paper collage, riso inks" } })).toEqual(["cut paper", "halloween", "paper collage", "risograph"]);
    expect(keeper.fallbackQueries({ series: "standalone" })).toEqual(["paper collage", "risograph"]);
    expect(keeper.parsePicks('{"picks": [3, 3, 99, 1, "2"], "summary": "warm orange paper"}', 10)).toEqual({ picks: [3, 1, 2], summary: "warm orange paper" });
    expect(() => keeper.parsePicks("none", 10)).toThrow(expect.objectContaining({ code: "claude_bad_output" }));
  });

  it("never stops the storyboard when Are.na is signed out", async () => {
    const run = async () => ({ stdout: JSON.stringify({}) });
    const kept = await keeper.keepBoard({ reelId: "abcdef12-0000", input: { series: "Sleep" } }, { progress: async () => {} }, { run, askClaude: async () => "" }, "/tmp");
    expect(kept).toMatchObject({ slug: null, tag: "abcdef12", summary: { title: "Tiny Soho · Sleep", error: expect.stringContaining("arena login") } });
  });
});
