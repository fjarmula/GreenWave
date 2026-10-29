import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "@/test-utils/render";
import { DocsBlocks } from "./DocsBlocks";

describe("DocsBlocks", () => {
  it("renders tables in their own scroll box with column headers", () => {
    const html = renderToStaticMarkup(
      <DocsBlocks blocks={[{ kind: "table", columns: ["A", "B"], rows: [["1", "2"]] }]} />,
    );
    expect(html).toContain('<div class="docs-table-scroll">');
    expect(html.match(/<th scope="col">/g)).toHaveLength(2);
  });

  it("renders commands verbatim with a copy button", () => {
    const code = "cd frontend\nnpm run dev";
    const html = renderToStaticMarkup(
      <DocsBlocks blocks={[{ kind: "code", label: "Frontend", code }]} />,
    );
    expect(html).toContain(`<code>${code}</code>`);
    expect(html).toMatch(/<button[^>]*>[\s\S]*Copy[\s\S]*<\/button>/);
  });

  it("names a code block by its label alone", () => {
    const html = renderToStaticMarkup(
      <DocsBlocks blocks={[{ kind: "code", label: "Frontend", code: "npm run dev" }]} />,
    );
    const labelledBy = html.match(/<figure[^>]*aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeDefined();
    expect(html).toContain(`id="${labelledBy}">Frontend</span>`);
    expect(html).not.toContain("<figcaption");
  });

  it("opens links in a new tab", () => {
    const html = renderToStaticMarkup(
      <DocsBlocks
        blocks={[{ kind: "links", items: [{ label: "OSM", href: "https://osm.org" }] }]}
      />,
    );
    expect(html).toContain('href="https://osm.org" target="_blank" rel="noopener"');
  });

  it("labels the architecture diagram with the node flow and shows the caption once", () => {
    const nodes = {
      sources: "Sources",
      etl: "ETL",
      dataset: "Dataset",
      api: "API",
      its: "ITS",
      stream: "Stream",
      dashboard: "Dashboard",
    };
    const html = renderToStaticMarkup(
      <DocsBlocks
        blocks={[{ kind: "diagram", diagram: "architecture", nodes, caption: "Flow" }]}
      />,
    );
    const flow = "Sources → ETL → Dataset → API → Stream → Dashboard; API ↔ ITS";
    expect(html.match(/<svg[^>]*role="img"[^>]*aria-label="([^"]*)"/)?.[1]).toBe(flow);
    expect(html.match(/Flow/g)).toHaveLength(1);
    expect(html).toContain("<figcaption>Flow</figcaption>");
    for (const label of Object.values(nodes)) expect(html).toContain(`>${label}<`);
  });

  it("marks the simulation-only note", () => {
    const html = renderToStaticMarkup(<DocsBlocks blocks={[{ kind: "note", text: "Sim" }]} />);
    expect(html).toMatch(/role="note"[^>]*>[\s\S]*Sim/);
  });
});
