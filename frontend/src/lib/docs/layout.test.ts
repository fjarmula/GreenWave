import { describe, expect, it } from "vitest";
import type { DocsBlock } from "./content";
import { groupDocsBlocks } from "./layout";

const p = (text: string): DocsBlock => ({ kind: "paragraph", text });
const h = (text: string): DocsBlock => ({ kind: "heading", text });
const table: DocsBlock = { kind: "table", columns: ["A"], rows: [["1"]] };
const note: DocsBlock = { kind: "note", text: "Sim" };

describe("groupDocsBlocks", () => {
  it("takes leading paragraphs and links as the intro", () => {
    const links: DocsBlock = { kind: "links", items: [{ label: "Demo", href: "https://x" }] };
    const { intro, items } = groupDocsBlocks([p("a"), links, h("H"), p("b")]);
    expect(intro).toEqual([p("a"), links]);
    expect(items).toHaveLength(1);
  });

  it("opens one group per heading with the blocks that follow it", () => {
    const { items } = groupDocsBlocks([h("One"), p("a"), p("b"), h("Two"), p("c")]);
    expect(items).toEqual([
      { kind: "group", heading: "One", blocks: [p("a"), p("b")] },
      { kind: "group", heading: "Two", blocks: [p("c")] },
    ]);
  });

  it("sets tables and diagrams apart at full width", () => {
    const { intro, items } = groupDocsBlocks([p("a"), table, h("H"), p("b")]);
    expect(intro).toEqual([p("a")]);
    expect(items[0]).toEqual({ kind: "wide", block: table });
  });

  it("sets a note apart and puts later headless blocks in their own group", () => {
    const { items } = groupDocsBlocks([h("H"), p("a"), note, p("b")]);
    expect(items).toEqual([
      { kind: "group", heading: "H", blocks: [p("a")] },
      { kind: "note", block: note },
      { kind: "group", heading: null, blocks: [p("b")] },
    ]);
  });
});
