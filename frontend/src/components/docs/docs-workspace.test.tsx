import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "@/test-utils/render";
import { LanguageProvider } from "@/components/language-provider";
import { SimulationProvider } from "@/components/simulation-provider";
import { DOCS_SECTION_IDS } from "@/lib/docs/tabs";
import { DocsWorkspace } from "./DocsWorkspace";

const english = () =>
  renderToStaticMarkup(
    <SimulationProvider>
      <DocsWorkspace />
    </SimulationProvider>,
  );

describe("DocsWorkspace", () => {
  it("names a tablist with six tabs", () => {
    const html = english();
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Documentation sections"/);
    expect(html.match(/role="tab"/g)).toHaveLength(6);
  });

  it("selects About first with roving focus", () => {
    const html = english();
    expect(html).toMatch(
      /<button(?=[^>]*id="docs-tab-about")(?=[^>]*aria-selected="true")(?=[^>]*tabindex="0")/,
    );
    for (const id of DOCS_SECTION_IDS.slice(1))
      expect(html).toMatch(new RegExp(`<button(?=[^>]*id="docs-tab-${id}")(?=[^>]*tabindex="-1")`));
  });

  it("links each tab to its panel", () => {
    const html = english();
    for (const id of DOCS_SECTION_IDS)
      expect(html).toMatch(
        new RegExp(
          `id="docs-tab-${id}"[^>]*aria-controls="docs-panel-${id}"|aria-controls="docs-panel-${id}"[^>]*id="docs-tab-${id}"`,
        ),
      );
    expect(html).toMatch(
      /role="tabpanel"(?=[^>]*id="docs-panel-about")(?=[^>]*aria-labelledby="docs-tab-about")/,
    );
  });

  it("renders only the About panel on the server", () => {
    expect(english().match(/role="tabpanel"/g)).toHaveLength(1);
  });

  it("defaults to Polish", () => {
    const html = render(
      <LanguageProvider>
        <SimulationProvider>
          <DocsWorkspace />
        </SimulationProvider>
      </LanguageProvider>,
    );
    expect(html).toContain("O projekcie");
    expect(html).toContain("Dokumentacja konkursowa");
  });
});
