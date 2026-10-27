import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DiagnosticsWorkspace } from "./DiagnosticsWorkspace";
import { SimulationProvider } from "@/components/simulation-provider";
it("pins the shared header with diagnostics actions", () => {
  const html = renderToStaticMarkup(
    <SimulationProvider>
      <DiagnosticsWorkspace />
    </SimulationProvider>,
  );
  expect(html).toContain('data-variant="page"');
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  expect(header).toContain("Clear observed history");
  expect(header).not.toContain("Developer view");
  expect(header).toContain('aria-label="ER–GreenWave home"');
  expect(html.match(/<h1/g)).toHaveLength(1);
});
