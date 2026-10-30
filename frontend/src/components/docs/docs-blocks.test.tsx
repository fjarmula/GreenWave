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

it("typesets formulas with italic variables and real subscripts, without a copy control", () => {
  const html = renderToStaticMarkup(
    <DocsBlocks
      blocks={[
        {
          kind: "formula",
          label: "Time to intersection",
          expression: "TTI_i = max(0, s_i − x) / v̄_{t−1}",
        },
      ]}
    />,
  );
  expect(html).toContain("<figcaption>Time to intersection</figcaption>");
  expect(html).toContain('role="math"');
  expect(html).toContain("TTI<sub><var>i</var></sub>");
  expect(html).toContain("max(0, <var>s</var><sub><var>i</var></sub> − <var>x</var>)");
  expect(html).toContain("<var>v̄</var><sub><var>t</var>−1</sub>");
  expect(html).not.toContain("_");
  expect(html).not.toContain("<button");
});

it("draws a flow as ordered steps with branches and an optional cycle", () => {
  const html = renderToStaticMarkup(
    <DocsBlocks
      blocks={[
        {
          kind: "flow",
          label: "Lifecycle",
          steps: [
            { label: "REQUESTED", branches: [{ label: "REJECTED", detail: "refused" }] },
            { label: "ACCEPTED", detail: "after 1 s" },
          ],
          cycle: "back to REQUESTED",
        },
      ]}
    />,
  );
  expect(html).toContain("<figcaption>Lifecycle</figcaption>");
  expect(html.match(/<li class="docs-flow-step"/g)).toHaveLength(2);
  expect(html).toMatch(/REQUESTED[\s\S]*class="docs-flow-branches"[\s\S]*REJECTED[\s\S]*ACCEPTED/);
  expect(html).toContain("after 1 s");
  expect(html).toContain("back to REQUESTED");
  expect(html).not.toContain("<pre");
});

describe("details reference", () => {
  const details = (language: "pl" | "en") =>
    docsContent[language].find((section) => section.id === "details")!;

  it.each(["pl", "en"] as const)("renders substantive %s content", (language) => {
    const html = renderToStaticMarkup(<DocsSectionView section={details(language)} />);
    for (const term of [
      "STANDARD_FALLBACK",
      "PRIORITY_GREEN",
      "its_ack_timeout_seconds",
      "min_intersection_delay_seconds",
      "estimated_standard_time_sec",
      "MIXED",
    ])
      expect(html).toContain(term);
  });

  it.each(["pl", "en"] as const)("keeps at most five core formulas in %s", (language) => {
    const formulas = details(language).blocks.filter((block) => block.kind === "formula");
    expect(formulas.length).toBeGreaterThanOrEqual(4);
    expect(formulas.length).toBeLessThanOrEqual(5);
  });

  it.each(["pl", "en"] as const)("draws its lifecycles as flows, not text, in %s", (language) => {
    const kinds = details(language).blocks.map((block) => block.kind);
    expect(kinds).not.toContain("state");
    expect(kinds.filter((kind) => kind === "flow").length).toBeGreaterThanOrEqual(3);
  });

  it("starts without the audit preamble", () => {
    expect(details("en").blocks[0].kind).not.toBe("paragraph");
    expect(JSON.stringify(details("en"))).not.toContain("This reference describes");
    expect(JSON.stringify(details("pl"))).not.toContain("Ten opis odtwarza");
  });
});

it("preserves canonical state identifiers when the operating-mode descriptions change language", () => {
  for (const language of ["pl", "en"] as const) {
    const architecture = docsContent[language].find((section) => section.id === "architecture")!;
    const html = renderToStaticMarkup(<DocsSectionView section={architecture} />);
    for (const state of ["NORMAL", "CLEARING", "PRIORITY_GREEN", "RECOVERY"])
      expect(html).toContain(`class="docs-card-label">${state}</span>`);
  }
});
