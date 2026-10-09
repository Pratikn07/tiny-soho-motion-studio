import { z } from "zod";

/**
 * Reads the brief the Claude.ai "Tiny Soho Reels" project writes (docs/reels/claude-project). The format is
 * labelled lines ("HOOK: ..."), a numbered SCRIPT DRAFT ("1. voice | on screen") and a FACTS list
 * ("- claim | source"). Parsing is forgiving: labels in any case, with or without a code fence, missing
 * fields left out. The raw text is always kept so nothing is lost.
 */
export const briefLineSchema = z.object({ voice: z.string().min(1).max(400), onScreen: z.string().max(200) });
export const briefFactSchema = z.object({ claim: z.string().min(1).max(400), source: z.string().max(300) });

export const reelBriefSchema = z.object({
  raw: z.string().max(8000),
  title: z.string().max(120).optional(),
  postBy: z.string().max(60).optional(),
  goal: z.string().max(60).optional(),
  angle: z.string().max(400).optional(),
  hook: z.string().max(200).optional(),
  twist: z.string().max(400).optional(),
  takeaway: z.string().max(300).optional(),
  savePrompt: z.string().max(200).optional(),
  captionQuestion: z.string().max(200).optional(),
  scriptDraft: z.array(briefLineSchema).max(20).optional(),
  facts: z.array(briefFactSchema).max(12).optional(),
  series: z.string().max(80).optional(),
  emotion: z.string().max(120).optional(),
  treatment: z.string().max(400).optional(),
  signatureMoment: z.string().max(300).optional(),
  references: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
});
export type ReelBrief = z.infer<typeof reelBriefSchema>;

type TextField = Exclude<keyof ReelBrief, "raw" | "scriptDraft" | "facts">;
const LIMITS = reelBriefSchema.shape;

const LABELS: Array<[RegExp, TextField | "scriptDraft" | "facts"]> = [
  [/^title$/, "title"], [/^post by$/, "postBy"], [/^goal$/, "goal"], [/^angle$/, "angle"], [/^hook$/, "hook"],
  [/^twist$/, "twist"], [/^takeaway$/, "takeaway"], [/^save prompt$/, "savePrompt"],
  [/^caption question$/, "captionQuestion"],
  [/^script draft/, "scriptDraft"], [/^facts?$/, "facts"], [/^series$/, "series"], [/^emotion$/, "emotion"],
  [/^treatment$/, "treatment"], [/^signature moment$/, "signatureMoment"],
  [/^(feel \/ )?references?/, "references"], [/^feel$/, "references"], [/^notes for studio/, "notes"],
];

function fieldFor(label: string) {
  const key = label.toLowerCase().replace(/\s+/g, " ").replace(/\(optional\)/, "").trim();
  return LABELS.find(([pattern]) => pattern.test(key))?.[1];
}

const clip = (text: string, max: number) => text.trim().slice(0, max);
const maxOf = (field: TextField) => (LIMITS[field].unwrap() as z.ZodString).maxLength ?? 400;

/** Parses a pasted brief. Returns null only when the text is empty. */
export function parseBrief(input: string): ReelBrief | null {
  const raw = input.trim().slice(0, 8000);
  if (!raw) return null;
  const lines = raw.replace(/^```[a-z]*\s*$/gim, "").split(/\r?\n/);
  const brief: ReelBrief = { raw };
  const text: Partial<Record<TextField, string[]>> = {};
  const script: z.infer<typeof briefLineSchema>[] = [];
  const facts: z.infer<typeof briefFactSchema>[] = [];
  let current: ReturnType<typeof fieldFor>;

  for (const line of lines) {
    const labelled = line.match(/^\s*([A-Za-z][A-Za-z /()]{1,40}?)\s*:\s*(.*)$/);
    const field = labelled ? fieldFor(labelled[1]) : undefined;
    const rest = field ? labelled![2] : line;
    if (field) current = field;
    // A label seen again starts its value over; only unlabelled lines continue the field above them.
    if (field && field !== "scriptDraft" && field !== "facts") delete text[field];
    if (!current || !rest.trim()) continue;
    if (current === "scriptDraft") {
      const item = rest.match(/^\s*\d+[.)]\s*(.+)$/);
      if (!item) continue;
      const [voice, ...screen] = item[1].split("|");
      if (voice.trim()) script.push({ voice: clip(voice, 400), onScreen: clip(screen.join("|"), 200) });
    } else if (current === "facts") {
      const item = rest.replace(/^\s*[-*•]\s*/, "");
      const [claim, ...source] = item.split("|");
      if (claim.trim()) facts.push({ claim: clip(claim, 400), source: clip(source.join("|"), 300) });
    } else {
      (text[current] ??= []).push(rest.trim());
    }
  }

  for (const [field, parts] of Object.entries(text) as Array<[TextField, string[]]>) {
    const value = clip(parts.join(" "), maxOf(field));
    if (value && !/^<.*>$/.test(value)) brief[field] = value;
  }
  if (script.length) brief.scriptDraft = script.slice(0, 20);
  if (facts.length) brief.facts = facts.slice(0, 12);
  return brief;
}

/** True when the brief has enough to write a script from: a hook or an angle, or a script draft. */
export function briefIsUsable(brief: ReelBrief) {
  return Boolean(brief.hook || brief.angle || brief.scriptDraft?.length);
}
