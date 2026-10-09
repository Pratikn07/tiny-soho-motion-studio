import { describe, expect, it } from "vitest";

// The runner is plain Node (runner/build.mjs).
const build: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/build.mjs", import.meta.url).href);

const take = {
  seconds: 7,
  lines: [{ n: 1, text: "[curious] Four bites?", start: 0.1, end: 1.2 }, { n: 2, text: "That might be dinner.", start: 1.6, end: 3 }],
  words: [{ n: 1, word: "Four", start: 0.1, end: 0.5 }, { n: 1, word: "bites?", start: 0.5, end: 1.2 },
    { n: 2, word: "That", start: 1.6, end: 1.8 }, { n: 2, word: "dinner.", start: 2.5, end: 3 }],
};

describe("build helpers", () => {
  it("turns a voice take into the engine's word-timing file, cues removed", () => {
    expect(build.lyricsFromTake(take)).toEqual({
      source: expect.any(String),
      lines: [
        { text: "Four bites?", start: 0.1, end: 1.2, words: [{ w: "Four", start: 0.1, end: 0.5 }, { w: "bites?", start: 0.5, end: 1.2 }] },
        { text: "That might be dinner.", start: 1.6, end: 3, words: [{ w: "That", start: 1.6, end: 1.8 }, { w: "dinner.", start: 2.5, end: 3 }] },
      ],
    });
  });

  it("cuts each scene in the pause before its line, and runs the last scene to the end", () => {
    const lyrics = build.lyricsFromTake(take);
    expect(build.sceneSpans(lyrics, 7, 2)).toEqual([{ n: 1, start: 0, end: 1.42 }, { n: 2, start: 1.42, end: 7 }]);
  });

  it("allows only the reel's own files to change", () => {
    const status = [" M app/src/timeline.ts", "?? app/src/scenes/r03_hook.ts", "?? app/src/timelines/r03.ts", " M app/src/scenes/_brand.ts",
      "?? data/reel03/", "?? app/src/scenes/r04_hook.ts", "?? audio/reel03/voiceover.mp3"].join("\n");
    expect(build.outsideChanges(status, "03")).toEqual(["app/src/timeline.ts", "app/src/scenes/_brand.ts", "app/src/scenes/r04_hook.ts"]);
    expect(build.reelId(3)).toBe("03");
  });

  it("reads scene errors from a render's output", () => {
    expect(build.sceneErrors("rendering…\nSCENE ERRORS:\nr03_hook: lyric not found: Four\n")).toEqual(["r03_hook: lyric not found: Four"]);
    expect(build.sceneErrors("wrote 3 stills")).toEqual([]);
  });

  it("refuses reel numbers below 03", async () => {
    await expect(build.buildJob({ input: { reelNo: 2 } }, null, { progress: async () => {}, env: {} }, {})).rejects.toMatchObject({ code: "build_bad_reel" });
  });
});
