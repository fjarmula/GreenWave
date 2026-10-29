import type { DocsBlock } from "./content";

export type DocsLayoutItem =
  | { kind: "group"; heading: string | null; blocks: DocsBlock[] }
  | { kind: "wide"; block: DocsBlock }
  | { kind: "note"; block: DocsBlock };

/** A section as the full-width page lays it out: an intro, then grid items (one panel each). */
export function groupDocsBlocks(blocks: DocsBlock[]) {
  const intro: DocsBlock[] = [];
  const items: DocsLayoutItem[] = [];
  let group: Extract<DocsLayoutItem, { kind: "group" }> | null = null;
  for (const block of blocks) {
    if (!items.length && !group && (block.kind === "paragraph" || block.kind === "links")) {
      intro.push(block);
    } else if (block.kind === "heading") {
      group = { kind: "group", heading: block.text, blocks: [] };
      items.push(group);
    } else if (block.kind === "table" || block.kind === "diagram" || block.kind === "note") {
      items.push({ kind: block.kind === "note" ? "note" : "wide", block });
      group = null;
    } else {
      if (!group) items.push((group = { kind: "group", heading: null, blocks: [] }));
      group.blocks.push(block);
    }
  }
  return { intro, items };
}
