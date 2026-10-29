export const DOCS_SECTION_IDS = [
  "about",
  "run",
  "tech",
  "data",
  "architecture",
  "roadmap",
] as const;
export type DocsSectionId = (typeof DOCS_SECTION_IDS)[number];

/** The active docs tab lives in the URL hash; anything unrecognised opens the first tab. */
export function sectionFromHash(hash: string): DocsSectionId {
  const id = hash.replace(/^#/, "");
  return (DOCS_SECTION_IDS as readonly string[]).includes(id) ? (id as DocsSectionId) : "about";
}

/** WAI-ARIA tabs keyboard model: arrows wrap, Home/End jump; other keys are not handled. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
