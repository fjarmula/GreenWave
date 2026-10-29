import { describe, expect, it } from "vitest";
import { docsContent, type DocsBlock } from "./content";
import { DOCS_SECTION_IDS } from "./tabs";

const languages = ["pl", "en"] as const;
const pairs = () =>
  docsContent.en.map((section, index) => [docsContent.pl[index], section] as const);

function strings(block: DocsBlock): string[] {
  switch (block.kind) {
    case "paragraph":
    case "heading":
    case "note":
      return [block.text];
    case "list":
      return block.items;
    case "table":
      return [...block.columns, ...block.rows.flat()];
    case "code":
      return [block.label, block.code];
    case "links":
      return block.items.flatMap((item) => [item.label, item.href]);
    case "diagram":
      return [block.caption, ...Object.values(block.nodes)];
  }
}

describe("docs content", () => {
  it("lists the five sections in order in both languages", () => {
    for (const language of languages)
      expect(docsContent[language].map((section) => section.id)).toEqual([...DOCS_SECTION_IDS]);
  });

  it("keeps Polish and English structurally identical", () => {
    for (const [pl, en] of pairs()) {
      expect(pl.blocks.map((block) => block.kind)).toEqual(en.blocks.map((block) => block.kind));
      en.blocks.forEach((block, index) => {
        const other = pl.blocks[index];
        if (block.kind === "table" && other.kind === "table") {
          expect(other.columns).toHaveLength(block.columns.length);
          expect(other.rows).toHaveLength(block.rows.length);
          for (const row of [...block.rows, ...other.rows])
            expect(row).toHaveLength(block.columns.length);
        }
        if (block.kind === "links" && other.kind === "links")
          expect(other.items.map((item) => item.href)).toEqual(
            block.items.map((item) => item.href),
          );
        if (block.kind === "list" && other.kind === "list")
          expect(other.items).toHaveLength(block.items.length);
      });
    }
  });

  it("has non-empty copy", () => {
    for (const language of languages)
      for (const section of docsContent[language]) {
        expect(section.label.trim()).not.toBe("");
        expect(section.title.trim()).not.toBe("");
        for (const text of section.blocks.flatMap(strings)) expect(text.trim()).not.toBe("");
      }
  });

  it("omits local setup instructions in both languages", () => {
    for (const language of languages) {
      expect(docsContent[language].map((section) => section.id)).not.toContain("run");
      expect(
        docsContent[language]
          .flatMap((section) => section.blocks)
          .some((block) => block.kind === "code"),
      ).toBe(false);
    }
  });

  it("shows the technology table as cards", () => {
    for (const language of languages) {
      const tech = docsContent[language].find((s) => s.id === "tech")!;
      expect(tech.blocks.find((block) => block.kind === "table")).toMatchObject({ cards: true });
    }
  });

  it("says simulation only in the architecture tab", () => {
    for (const language of languages) {
      const architecture = docsContent[language].find((s) => s.id === "architecture");
      expect(architecture?.blocks.some((block) => block.kind === "note")).toBe(true);
    }
  });
});

it("explains the dashed ITS exchange in both diagram captions", () => {
  const caption = (language: "pl" | "en") => {
    const diagram = docsContent[language]
      .find((section) => section.id === "architecture")
      ?.blocks.find((block) => block.kind === "diagram");
    return diagram?.kind === "diagram" ? diagram.caption : "";
  };
  expect(caption("pl")).toContain("Przerywana strzałka");
  expect(caption("pl")).toContain("żądania priorytetu i odpowiedzi");
  expect(caption("en")).toContain("dashed two-way arrow");
  expect(caption("en")).toContain("within the simulation");
});
