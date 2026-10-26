import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ComparisonGlyph,
  GreenWaveGlyph,
  StandardTrafficGlyph,
} from "@/components/workspace/ModeGlyphs";
import { HomeMenu } from "@/components/workspace/HomeMenu";
import { SimulationProvider } from "@/components/simulation-provider";

const count = (html: string, tag: string) => html.match(new RegExp(`<${tag}`, "g"))?.length ?? 0;

describe("mode glyphs", () => {
  it.each([
    ["Green Wave", GreenWaveGlyph, 1, 1],
    ["Standard traffic", StandardTrafficGlyph, 1, 1],
    ["Comparison", ComparisonGlyph, 2, 2],
  ] as const)("%s draws its line and vehicle in currentColor", (_, Glyph, paths, dots) => {
    const html = renderToStaticMarkup(<Glyph />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke="currentColor"');
    expect(count(html, "path")).toBe(paths);
    expect(count(html, "circle")).toBe(dots);
  });

  it("replaces the stock mode icons on the home cards", () => {
    const html = renderToStaticMarkup(
      <SimulationProvider>
        <HomeMenu />
      </SimulationProvider>,
    );
    for (const stock of ["lucide-waves", "lucide-traffic-cone", "lucide-git-compare-arrows"])
      expect(html).not.toContain(stock);
  });
});
