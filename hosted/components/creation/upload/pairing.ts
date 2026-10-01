import { LAYER_MIME_TYPES } from "@/lib/contract";

/** Pairs dropped files into slides by name: `potty-background.webp` + `potty-text.png` make the slide "potty". */

export const MAX_LAYER_BYTES = 25 * 1024 * 1024;

export type LayerRole = "background" | "text";
export type FileRole = LayerRole | "unknown";

export type LayerPair = {
  /** Lower-cased name shared by both files; identifies the pair while it waits. */
  key: string;
  /** Slide name shown to the creator, from the file name without its role suffix. */
  name: string;
  background: File;
  text: File | null;
};

export type UnpairedFile = { file: File; role: FileRole; reason: string };
export type RejectedFile = { file: File; reason: string };
export type Pairing = { pairs: LayerPair[]; unpaired: UnpairedFile[]; rejected: RejectedFile[] };

const ROLE_WORDS: Record<string, LayerRole> = {
  background: "background",
  bg: "background",
  text: "text",
  txt: "text",
};
const SUFFIX = /^(.*?)[\s._-]+(background|bg|text|txt)$/i;

const extensionless = (name: string) => name.replace(/\.[^.]+$/, "");

/** Name without its extension and role suffix, plus the role the suffix names. */
export function describeFile(name: string): { stem: string; role: FileRole } {
  const base = extensionless(name).trim();
  const match = SUFFIX.exec(base);
  if (!match || !match[1].trim()) return { stem: base, role: "unknown" };
  return { stem: match[1].trim(), role: ROLE_WORDS[match[2].toLowerCase()] };
}

const backgroundTypes: readonly string[] = LAYER_MIME_TYPES.background;

function rejection(file: File): string | null {
  if (!backgroundTypes.includes(file.type)) return "Use a PNG, JPG or WebP file.";
  if (file.size > MAX_LAYER_BYTES) return "This file is larger than 25 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural order, so "slide 2" comes before "slide 10". */
export const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);

export function pairFiles(files: readonly File[]): Pairing {
  const rejected: RejectedFile[] = [];
  const groups = new Map<string, { name: string; background: File[]; text: File[]; unknown: File[] }>();
  for (const file of files) {
    const problem = rejection(file);
    if (problem) {
      rejected.push({ file, reason: problem });
      continue;
    }
    const { stem, role } = describeFile(file.name);
    const key = stem.toLowerCase();
    const group = groups.get(key) ?? { name: stem, background: [], text: [], unknown: [] };
    group[role].push(file);
    groups.set(key, group);
  }

  const pairs: LayerPair[] = [];
  const unpaired: UnpairedFile[] = [];
  for (const [key, group] of groups) {
    const leftOver = (list: File[], role: FileRole, reason: string) => {
      for (const file of list) unpaired.push({ file, role, reason });
    };
    if (group.background.length === 1 && group.text.length === 1 && group.text[0].type === "image/png") {
      pairs.push({ key, name: group.name, background: group.background[0], text: group.text[0] });
      leftOver(group.unknown, "unknown", "Its name doesn't say whether it's a background or a text layer.");
      continue;
    }
    if (group.background.length > 1 || group.text.length > 1) {
      leftOver(group.background, "background", `More than one background is named "${group.name}".`);
      leftOver(group.text, "text", `More than one text layer is named "${group.name}".`);
    } else {
      const textIsPng = group.text.every((file) => file.type === "image/png");
      leftOver(group.background, "background", group.text.length && !textIsPng
        ? "Its text layer isn't a PNG, so it can't be paired."
        : "No text layer has the same name.");
      leftOver(group.text, "text", textIsPng ? "No background has the same name." : "Text layers must be PNG files with transparency.");
    }
    leftOver(group.unknown, "unknown", "Its name doesn't say whether it's a background or a text layer.");
  }
  pairs.sort(byName);
  unpaired.sort((a, b) => byName(a.file, b.file));
  return { pairs, unpaired, rejected };
}

/** A background used without a text layer: nothing will animate in, but the slide still moves. */
export function backgroundOnly(file: File): LayerPair {
  const name = describeFile(file.name).stem;
  return { key: `alone:${name.toLowerCase()}:${file.name}`, name, background: file, text: null };
}

const RATIOS: Array<[string, number]> = [
  ["4:5", 4 / 5],
  ["9:16", 9 / 16],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["16:9", 16 / 9],
  ["5:4", 5 / 4],
];

/** The nearest common ratio within 2%, else the exact pixel size. */
export function ratioLabel(width: number, height: number): string {
  const ratio = width / height;
  const match = RATIOS.find(([, value]) => Math.abs(ratio - value) / value <= 0.02);
  return match ? match[0] : `${width}×${height}`;
}
