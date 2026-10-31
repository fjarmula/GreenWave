import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { docsContent, type DocsBlock } from "./content";

const repo = (file: string) => readFileSync(path.resolve(process.cwd(), "..", file), "utf8");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const english = docsContent.en;
const blocks = english.flatMap((section) => section.blocks);

function prose(block: DocsBlock): string[] {
  if (block.kind === "paragraph" || block.kind === "note") return [block.text];
  if (block.kind === "list") return block.items;
  if (block.kind === "table") return block.rows.flat();
  return [];
}

it("names every dataset", () => {
  const data = english.find((section) => section.id === "data")!;
  const table = data.blocks.find((block) => block.kind === "table");
  const names = table?.kind === "table" ? table.rows.map((row) => row[0]).join(" | ") : "";
  for (const dataset of ["OpenStreetMap", "Ulice", "Buspasy", "EMUiA", "PRM"])
    expect(names).toContain(dataset);
});

it("does not copy repo wording", () => {
  const docs = [
    "README.md",
    "GreenWave_ARCHITECTURE.md",
    "backend/README.md",
    "frontend/README.md",
  ].map((file) => normalize(repo(file)));
  const sentences = blocks
    .flatMap(prose)
    .flatMap((text) => text.split(/(?<=[.!?])\s+/))
    .map(normalize)
    .filter((sentence) => sentence.length >= 40);
  expect(sentences.length).toBeGreaterThan(0);
  for (const sentence of sentences)
    for (const doc of docs) expect(doc.includes(sentence), sentence).toBe(false);
});

it("never claims real signal control", () => {
  for (const text of blocks.flatMap(prose))
    expect(text).not.toMatch(
      /\b(controls|actuates) (real|physical) (traffic )?(signals|lights)\b/i,
    );
});

it("publishes matching post-fix model results and the durable report in both languages", () => {
  const reportUrl =
    "https://github.com/fjarmula/GreenWave/blob/main/docs/results/2026-10-31/REPORT.md";
  for (const language of ["pl", "en"] as const) {
    const about = docsContent[language].find((section) => section.id === "about")!;
    const text = about.blocks.flatMap(prose).join(" ");
    for (const value of ["200", "600", "3 000", "6 000", "89%", "11%", "0%"])
      expect(text).toContain(value);
    expect(
      about.blocks.some(
        (block) => block.kind === "links" && block.items.some((item) => item.href === reportUrl),
      ),
    ).toBe(true);
    const table = about.blocks.find((block) => block.kind === "table");
    expect(table?.kind === "table" ? table.rows : []).toHaveLength(5);
  }
  expect(repo("README.md")).toContain(reportUrl);
  expect(repo("docs/results/2026-10-31/REPORT.md")).toContain(
    "e79afd52dd2a29cac88c4ef18e864dc0f66a68aa",
  );
});
