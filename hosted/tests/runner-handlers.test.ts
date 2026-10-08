import { describe, expect, it } from "vitest";

import { lookSchema, safeSketch, sceneSchema, scriptLineSchema } from "@/lib/reels";

// The runner is plain Node (runner/handlers.mjs); its parsers must produce what the Studio accepts.
const handlers: Record<string, (text: string) => any> = await import(/* @vite-ignore */ new URL("../../runner/handlers.mjs", import.meta.url).href);

describe("runner parsers", () => {
  it("reads a storyboard and cleans what the Studio would reject", () => {
    const text = `Here it is:\n${JSON.stringify({ scenes: [
      { n: 1, line: "Hook", paper: "Cream", codeDraws: "Headline", move: "Rise", transition: "Clock",
        images: [{ file: "R02 Anaika Yawn.png", purpose: "Anaika", prompt: "Anaika yawning", aspect: "3:2", background: "none", reference: "Anaika", reuse: "" }] },
      { line: "No number", images: "none" },
    ], notes: "Check the clock." })}`;
    const { scenes, notes } = handlers.parseStoryboard(text);
    expect(notes).toBe("Check the clock.");
    expect(scenes[0].images[0]).toMatchObject({ file: "r02_anaika_yawn.png", aspect: "9:16", background: "transparent", reference: "none" });
    expect(scenes[1]).toMatchObject({ n: 2, images: [] });
    for (const scene of scenes) expect(sceneSchema.safeParse(scene).success).toBe(true);
  });

  it("reads looks and scripts in the Studio's shapes", () => {
    const looks = handlers.parseLooks(`[{"name": "Paper theatre", "treatment": "Stage", "emotion": "Warm", "accent": "Gold", "signatureMoment": "Curtain", "music": "Music box", "why": "Storybook"}]`);
    expect(lookSchema.safeParse(looks[0]).success).toBe(true);
    // A long treatment survives the runner and still passes the Studio's check, so it isn't cut or dropped.
    const [long] = handlers.parseLooks(JSON.stringify([{ name: "Evidence board", treatment: "t".repeat(780), signatureMoment: "s".repeat(500), why: "w".repeat(350) }]));
    expect(long.treatment).toHaveLength(780);
    expect(lookSchema.safeParse(long).success).toBe(true);
    const { lines } = handlers.parseScript(`{"lines": [{"time": "0:00", "voice": "[curious] Hook", "onScreen": "HOOK"}], "notes": ""}`);
    expect(scriptLineSchema.safeParse(lines[0]).success).toBe(true);
  });

  it("ships the motion library with the runner, with off-brand styles kept out of the fits", () => {
    const library = String((handlers as Record<string, unknown>).MOTION_LIBRARY);
    expect(library).toContain("## 2. Treatments");
    const fits = library.slice(library.indexOf("### Fits Tiny Soho"), library.indexOf("### Use with care"));
    const offBrand = library.slice(library.indexOf("### Off-brand"), library.indexOf("## 2."));
    for (const style of ["Glitch", "Synthwave", "Neon sign", "Particles"]) {
      expect(offBrand).toContain(style);
      expect(fits).not.toContain(style);
    }
  });

  it("gives looks and storyboards more time than ideas and scripts", () => {
    expect(handlers.LOOK_TIMEOUT_MS).toBe(5 * 60_000);
    expect(handlers.STORYBOARD_TIMEOUT_MS).toBe(10 * 60_000);
  });

  it("pulls a sketch out of Claude's answer and refuses unsafe ones", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><rect width="1080" height="1920"/></svg>';
    expect(handlers.parseSketch("```svg\n" + svg + "\n```")).toBe(svg);
    expect(safeSketch(handlers.parseSketch(svg))).toBe(svg);
    expect(() => handlers.parseSketch("<svg><script>x()</script></svg>")).toThrow(expect.objectContaining({ code: "sketch_unsafe" }));
    expect(() => handlers.parseSketch("No sketch, sorry")).toThrow(expect.objectContaining({ code: "claude_bad_output" }));
    expect(handlers.SKETCH_TIMEOUT_MS).toBe(3 * 60_000);
  });

  it("reads the Studio Mac's verdict on an image", () => {
    expect(handlers.parseImageCheck('{"verdict": "redo", "notes": "Anaika looks upset; make it a pout."}')).toEqual({ verdict: "redo", notes: "Anaika looks upset; make it a pout." });
    expect(() => handlers.parseImageCheck('{"verdict": "maybe"}')).toThrow(expect.objectContaining({ code: "claude_bad_output" }));
    expect(handlers.IMAGE_CHECK_TIMEOUT_MS).toBe(3 * 60_000);
  });

  it("fails clearly when Claude doesn't answer with JSON", () => {
    expect(() => handlers.parseStoryboard("Sorry, I can't.")).toThrow(expect.objectContaining({ code: "claude_bad_output" }));
    expect(() => handlers.parseLooks("[not json]")).toThrow(expect.objectContaining({ code: "claude_bad_output" }));
  });
});
