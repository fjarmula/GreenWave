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

it("links the live demo", () => {
  const run = english.find((section) => section.id === "run")!;
  expect(
    run.blocks.some(
      (block) =>
        block.kind === "links" &&
        block.items.some((item) => item.href === "https://green-wave.duckdns.org/"),
    ),
  ).toBe(true);
});

it("only shows commands the README documents", () => {
  const readme = repo("README.md");
  const codes = blocks.filter((block) => block.kind === "code");
  expect(codes.length).toBeGreaterThan(0);
  for (const block of codes)
    for (const line of block.code.split("\n")) {
      const command = line.replace(/\s+#.*$/, "").trim();
      if (command) expect(readme).toContain(command);
    }
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
