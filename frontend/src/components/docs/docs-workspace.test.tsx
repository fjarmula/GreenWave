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
  it("names a tablist with five tabs", () => {
    const html = english();
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Documentation sections"/);
    expect(html.match(/role="tab"/g)).toHaveLength(5);
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

  it("shows a simulation-mode badge distinct from the demo link", () => {
    const html = english();
    expect(html).toMatch(/data-testid="simulation-mode-badge"[\s\S]*?Simulation mode<\/span>/);
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("bg-zinc-900/80");
    expect(html).toContain("border-neutral-700/60");
    expect(html).toMatch(/class="docs-chip"[^>]*href="https:\/\/green-wave\.duckdns\.org\/"/);
  });

  it("uses an SVG external-link icon and a documentation navigation rail", () => {
    const html = english();
    expect(html).not.toContain("↗");
    expect(html).toContain('class="docs-navigation"');
    expect(html).toMatch(/Live demo[\s\S]*?<svg/);
    expect(html).toMatch(
      /href="https:\/\/github.com\/fjarmula\/GreenWave"[^>]*>[\s\S]*?GitHub[\s\S]*?<svg/,
    );
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).not.toContain("Contest documentation");
    expect(html).toMatch(/<h1[^>]*>Documentation<\/h1>/);
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
    expect(html).toContain("Dokumentacja");
    expect(html).not.toContain("Dokumentacja konkursowa");
    expect(html).toContain("Tryb symulacji");
    expect(html).toContain("Aplikacja służy wyłącznie do celów demonstracyjnych.");
    expect(html).not.toContain(">Wyłącznie symulacja<");
  });
});
