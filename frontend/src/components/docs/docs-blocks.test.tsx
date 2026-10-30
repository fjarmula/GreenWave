import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "@/test-utils/render";
import { docsContent } from "@/lib/docs/content";
import { DocsBlocks } from "./DocsBlocks";
import { DocsSectionView } from "./DocsSectionView";

describe("DocsBlocks", () => {
  it("renders tables in their own scroll box with column headers", () => {
    const html = renderToStaticMarkup(
      <DocsBlocks blocks={[{ kind: "table", columns: ["A", "B"], rows: [["1", "2"]] }]} />,
    );
    expect(html).toContain('<div class="docs-table-scroll">');
    expect(html.match(/<th scope="col">/g)).toHaveLength(2);
  });

  it("renders a cards table as one labelled card per row", () => {
    const html = renderToStaticMarkup(
      <DocsBlocks
        blocks={[
          {
            kind: "table",
            cards: true,
            columns: ["Layer", "Tech", "Why"],
            rows: [
              ["Map", "MapLibre", "WebGL"],
              ["API", "FastAPI", "Typed"],
            ],
          },
        ]}
      />,
    );
    expect(html).not.toContain("<table");
    expect(html.match(/<li class="docs-card">/g)).toHaveLength(2);
    expect(html).toMatch(/Map<\/span>[\s\S]*MapLibre[\s\S]*WebGL/);
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

describe("DocsSectionView", () => {
  const about = docsContent.en[0];

  it("puts the leading paragraphs in the lead and each heading in its own panel", () => {
    const html = renderToStaticMarkup(<DocsSectionView section={about} />);
    expect(html).toMatch(/<div class="docs-lead"><p>ER-GreenWave/);
    const headings = about.blocks.filter((block) => block.kind === "heading").length;
    expect(html.match(/<section class="docs-group"/g)).toHaveLength(headings);
    expect(html).toMatch(/class="docs-grid"[\s\S]*role="note"/);
  });

  it("spans tables across the grid", () => {
    const data = docsContent.en.find((section) => section.id === "data")!;
    expect(renderToStaticMarkup(<DocsSectionView section={data} />)).toContain(
      '<div class="docs-wide"><div class="docs-data-table"><div class="docs-table-scroll">',
    );
  });

  it("numbers the steps of a numbered section only", () => {
    const steps = renderToStaticMarkup(
      <DocsSectionView
        section={{
          id: "about",
          label: "Steps",
          title: "Steps",
          numbered: true,
          blocks: [
            { kind: "heading", text: "First" },
            { kind: "paragraph", text: "Details" },
          ],
        }}
      />,
    ).match(/class="docs-step">(\d+)</g);
    expect(steps).toHaveLength(1);
    expect(renderToStaticMarkup(<DocsSectionView section={about} />)).not.toContain("docs-step");
  });
});

it("offers labelled source details for narrow screens", () => {
  const html = renderToStaticMarkup(
    <DocsBlocks
      blocks={[
        {
          kind: "table",
          columns: ["Source", "Publisher", "Use"],
          rows: [["OSM", "Community", "Road graph"]],
        },
      ]}
    />,
  );
  expect(html).toContain('class="docs-table-mobile"');
  expect(html).toContain("<dt>Publisher</dt><dd>Community</dd>");
});

it("renders readable mathematical notation with its label, without a command-copy control", () => {
  const html = renderToStaticMarkup(
    <DocsBlocks
      blocks={[
        { kind: "formula", label: "Time to intersection", expression: "TTIᵢ = max(0, sᵢ − x) / v̄" },
      ]}
    />,
  );
  expect(html).toContain("<figcaption>Time to intersection</figcaption>");
  expect(html).toContain('role="math"');
  expect(html).toContain("TTIᵢ = max(0, sᵢ − x) / v̄");
  expect(html).not.toContain("<button");
});

it("renders the in-app system logic reference as substantive content in both languages", () => {
  for (const language of ["pl", "en"] as const) {
    const logic = docsContent[language].find((section) => section.id === "logic");
    expect(logic).toBeDefined();
    const html = renderToStaticMarkup(<DocsSectionView section={logic!} />);
    for (const implementedTerm of [
      "STANDARD_FALLBACK",
      "PRIORITY_GREEN",
      "its_ack_timeout_seconds",
      "min_intersection_delay_seconds",
      "estimated_standard_time_sec",
      "MIXED",
    ])
      expect(html).toContain(implementedTerm);
    expect(html.match(/role="math"/g)?.length).toBeGreaterThan(5);
    expect(html).toContain("&lt;= 25");
  }
});
