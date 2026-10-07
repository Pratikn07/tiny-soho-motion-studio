/** The Studio's top-level sections, in navigation order. */
export const SECTIONS = [
  { id: "reels", label: "Reels" },
  { id: "carousels", label: "Carousels" },
  { id: "library", label: "Library" },
  { id: "creations", label: "Creations" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** Carousels is the working section today, so it opens first until Reels has its first screens. */
export const DEFAULT_SECTION: SectionId = "carousels";

export function isSection(value: string): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

/** Reads the section from a URL hash such as `#reels`; anything else falls back to the default. */
export function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#/, "");
  return isSection(id) ? id : DEFAULT_SECTION;
}
