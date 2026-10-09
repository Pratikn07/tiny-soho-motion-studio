import { describe, expect, it } from "vitest";

// The runner is plain Node (runner/sound.mjs, runner/export.mjs).
const sound: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/sound.mjs", import.meta.url).href);
const exporter: Record<string, any> = await import(/* @vite-ignore */ new URL("../../runner/export.mjs", import.meta.url).href);

describe("sound helpers", () => {
  it("asks for calm instrumental music in the series' sound, as long as the reel", () => {
    const prompt = sound.musicPrompt({ look: { music: "celesta and a ticking clock" }, series: "Halloween", scenes: [{ n: 1, move: "stamp lands" }], seconds: 28.6 });
    expect(prompt).toContain("29-second");
    expect(prompt).toContain("celesta and a ticking clock");
    expect(prompt).toContain("music-box lullaby");
    expect(prompt).toContain("no vocals");
  });

  it("names new effects per reel without clashing with any library", () => {
    const taken = sound.usedIds({ sfx: [{ id: "r03_pin" }] }, { sfx: [{ id: "r02_pin_a" }] });
    expect(sound.effectId("03", "Pin", taken)).toBe("r03_pin_2");
    expect(sound.effectId("03", "soft stamp!", taken)).toBe("r03_soft_stamp");
  });

  it("reads a cue sheet and keeps times and gains in range", () => {
    const cues = sound.parseCues('[{"scene":1,"t":-2,"name":"pin","prompt":"a pin pressed into felt","duration":9,"gainDb":5},{"t":40,"name":"x","prompt":""}]', 30);
    expect(cues).toEqual([{ t: 0, name: "pin", prompt: "a pin pressed into felt", duration: 4, gainDb: 0, scene: 1 }]);
    expect(() => sound.parseCues("no", 30)).toThrow(expect.objectContaining({ code: "claude_bad_output" }));
  });

  it("asks for an ElevenLabs key before making sound", async () => {
    await expect(sound.soundJob({ input: { reelNo: 3 } }, null, { progress: async () => {}, env: {} }, {})).rejects.toMatchObject({ code: "elevenlabs_not_set_up" });
  });
});

describe("export helpers", () => {
  it("reads a caption and hashtags", () => {
    expect(exporter.parseCaption('{"caption":"Four bites can be dinner.\\nMore at mycuratedhaven.com · link in bio","hashtags":["toddlermom","#picky eating"]}'))
      .toEqual({ caption: "Four bites can be dinner.\nMore at mycuratedhaven.com · link in bio", hashtags: ["#toddlermom", "#pickyeating"] });
  });
});
