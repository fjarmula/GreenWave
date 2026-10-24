import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const components = path.resolve(import.meta.dirname, "../components");
const UI_DIRS = ["hud", "diagnostics", "comparison", "workspace", "driver"];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

const files = UI_DIRS.flatMap((dir) => sources(path.join(components, dir)));
const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

describe("type scale", () => {
  it.each(files.map((file) => [path.relative(components, file), file]))(
    "%s uses scale sizes, not arbitrary pixels",
    (_, file) => {
      expect(readFileSync(file, "utf8").match(/text-\[\d+px\]/g) ?? []).toEqual([]);
    },
  );

  it("defines the 11px floor size", () => {
    expect(css).toMatch(/--text-2xs:\s*11px/);
  });

  it("balances headings and prettifies paragraphs", () => {
    expect(css).toMatch(/h1,\s*h2,\s*h3\s*{\s*text-wrap:\s*balance/);
    expect(css).toMatch(/p\s*{\s*text-wrap:\s*pretty/);
  });

  it("keeps mono for values, not labels", () => {
    const labels = files.flatMap(
      (file) => readFileSync(file, "utf8").match(/font-mono[^"]*">[a-z ]+</g) ?? [],
    );
    expect(labels).toEqual([]);
  });
});

describe("restraint", () => {
  it.each(files.map((file) => [path.relative(components, file), file]))(
    "%s has no text glows or Tailwind pulse",
    (_, file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/text-shadow|animate-pulse/);
    },
  );
});
