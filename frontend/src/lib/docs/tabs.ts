export const DOCS_SECTION_IDS = [
  "about",
  "tech",
  "data",
  "architecture",
  "details",
  "roadmap",
] as const;
export type DocsSectionId = (typeof DOCS_SECTION_IDS)[number];

/** Hashes that were published under an earlier tab name. */
const RENAMED: Record<string, DocsSectionId> = { logic: "details" };

/** The active docs tab lives in the URL hash; anything unrecognised opens the first tab. */
export function sectionFromHash(hash: string): DocsSectionId {
  const id = hash.replace(/^#/, "");
  if (id in RENAMED) return RENAMED[id];
  return (DOCS_SECTION_IDS as readonly string[]).includes(id) ? (id as DocsSectionId) : "about";
}

/** WAI-ARIA tabs keyboard model: arrows wrap, Home/End jump; other keys are not handled. */
export function nextTabIndex(
  key: string,
  current: number,
  count: number,
  orientation: "horizontal" | "vertical" = "horizontal",
): number | null {
  if (key === (orientation === "vertical" ? "ArrowDown" : "ArrowRight"))
    return (current + 1) % count;
  if (key === (orientation === "vertical" ? "ArrowUp" : "ArrowLeft"))
    return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
