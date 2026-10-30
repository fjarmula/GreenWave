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
    case "formula":
      return [block.label, block.expression];
    case "code":
      return [block.label, block.code];
    case "links":
      return block.items.flatMap((item) => [item.label, item.href]);
    case "diagram":
      return [block.caption, ...Object.values(block.nodes)];
    case "flow":
      return [
        block.label,
        ...(block.cycle ? [block.cycle] : []),
        ...block.steps.flatMap((step) => [
          step.label,
          ...(step.detail ? [step.detail] : []),
          ...(step.branches ?? []).flatMap((branch) => [
            branch.label,
            branch.detail ?? branch.label,
          ]),
        ]),
      ];
  }
}

describe("docs content", () => {
  it("lists the documentation sections in order in both languages", () => {
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
        if (block.kind === "flow" && other.kind === "flow")
          expect(other.steps.map((step) => step.branches?.length ?? 0)).toEqual(
            block.steps.map((step) => step.branches?.length ?? 0),
          );
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

  it("credits the authors in the footer rather than the About tab", () => {
    for (const language of languages) {
      const about = docsContent[language].find((s) => s.id === "about")!;
      expect(JSON.stringify(about)).not.toContain("Lorek");
    }
  });

  it("shows the system-level run flows in the architecture tab", () => {
    for (const language of languages) {
      const architecture = docsContent[language].find((s) => s.id === "architecture")!;
      expect(architecture.blocks.filter((block) => block.kind === "flow")).toHaveLength(2);
      expect(architecture.blocks.some((block) => block.kind === "table")).toBe(true);
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

it("preserves configuration identifiers and equations between languages", () => {
  const reference = (language: "pl" | "en") => docsContent[language].flatMap((s) => s.blocks);
  const identifiers = (language: "pl" | "en") =>
    reference(language).flatMap((block) =>
      block.kind === "table"
        ? block.rows.filter((row) => /^[a-zA-Z][a-zA-Z0-9]*_/.test(row[0]))
        : [],
    );
  expect(identifiers("pl").map((row) => row[0])).toEqual(identifiers("en").map((row) => row[0]));
  const equations = (language: "pl" | "en") =>
    reference(language).flatMap((block) => (block.kind === "formula" ? [block.expression] : []));
  expect(equations("pl")).toEqual(equations("en"));
});
