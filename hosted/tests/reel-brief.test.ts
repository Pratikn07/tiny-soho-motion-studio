import { describe, expect, it } from "vitest";

import { briefIsUsable, parseBrief } from "@/lib/reel-brief";

const REEL01 = `\`\`\`
TITLE: It's Not the Sugar
POST BY: 29 Oct 2026
GOAL: comments
ANGLE: Halloween meltdowns are probably caused by the night itself, not the candy.
HOOK: That Halloween meltdown? It's probably NOT the sugar.
TWIST: In a study, moms who were told their kid had sugar rated them more hyper.
TAKEAWAY: Skip the candy guilt and protect the bedtime.
SAVE PROMPT: Save this for Halloween night.
SCRIPT DRAFT (optional):
1. [curious] That Halloween meltdown? It's probably NOT the sugar. | "It's not the sugar." with grumpy Anaika
2. [matter-of-fact] Careful studies haven't found that sugar changes kids' behavior. | MYTH stamp
FACTS:
- Sugar does not change children's behavior | Wolraich et al., JAMA, 1995
- Mothers told their son had sugar rated him more hyperactive | Hoover & Milich, 1994
SERIES: Halloween
EMOTION: playful, guilt lifted
TREATMENT: cut-paper collage, sticker cut-outs
SIGNATURE MOMENT: the SUGAR label peels off the cup
\`\`\``;

describe("parseBrief", () => {
  it("reads every field of the Claude project's brief", () => {
    const brief = parseBrief(REEL01)!;
    expect(brief).toMatchObject({
      title: "It's Not the Sugar", postBy: "29 Oct 2026", goal: "comments", hook: "That Halloween meltdown? It's probably NOT the sugar.",
      savePrompt: "Save this for Halloween night.", series: "Halloween", emotion: "playful, guilt lifted",
      treatment: "cut-paper collage, sticker cut-outs", signatureMoment: "the SUGAR label peels off the cup",
    });
    expect(brief.scriptDraft).toEqual([
      { voice: "[curious] That Halloween meltdown? It's probably NOT the sugar.", onScreen: "\"It's not the sugar.\" with grumpy Anaika" },
      { voice: "[matter-of-fact] Careful studies haven't found that sugar changes kids' behavior.", onScreen: "MYTH stamp" },
    ]);
    expect(brief.facts).toEqual([
      { claim: "Sugar does not change children's behavior", source: "Wolraich et al., JAMA, 1995" },
      { claim: "Mothers told their son had sugar rated him more hyperactive", source: "Hoover & Milich, 1994" },
    ]);
    expect(brief.raw).toContain("TITLE: It's Not the Sugar");
    expect(briefIsUsable(brief)).toBe(true);
  });

  it("accepts lowercase labels, no code fence and text that wraps onto the next line", () => {
    const brief = parseBrief("hook: The worst week\nangle: Halloween and the clock change\nland on one weekend.\nfeel / references: cosy")!;
    expect(brief.hook).toBe("The worst week");
    expect(brief.angle).toBe("Halloween and the clock change land on one weekend.");
    expect(brief.references).toBe("cosy");
    expect(brief.scriptDraft).toBeUndefined();
  });

  it("lets a repeated label replace the earlier value", () => {
    expect(parseBrief("HOOK: First try\nSERIES: Halloween\nHOOK: Better hook")!.hook).toBe("Better hook");
  });

  it("skips template placeholders and leaves missing fields out", () => {
    const brief = parseBrief("TITLE: <short working title>\nHOOK: A real hook")!;
    expect(brief.title).toBeUndefined();
    expect(brief.hook).toBe("A real hook");
  });

  it("says when there's nothing to write a script from", () => {
    expect(parseBrief("   ")).toBeNull();
    expect(briefIsUsable(parseBrief("Just some notes about Halloween")!)).toBe(false);
    expect(briefIsUsable(parseBrief("TITLE: Only a title")!)).toBe(false);
  });

  it("keeps long input within the limits", () => {
    const brief = parseBrief(`HOOK: ${"a".repeat(500)}\n${"x".repeat(9000)}`)!;
    expect(brief.hook).toHaveLength(200);
    expect(brief.raw.length).toBeLessThanOrEqual(8000);
  });
});
