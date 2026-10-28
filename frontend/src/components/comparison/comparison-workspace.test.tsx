import { renderToStaticMarkup } from "@/test-utils/render";
import { expect, it, vi } from "vitest";
import { ComparisonWorkspace } from "./ComparisonWorkspace";
import { ComparisonProvider } from "./ComparisonProvider";
import { ScenarioProvider } from "@/components/scenario-provider";
import { SimulationProvider } from "@/components/simulation-provider";
import { SimulationRuntime } from "@/components/simulation-runtime";
vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: () => <div aria-label="Scenario selection map" />,
}));
it("offers destination, vehicle and traffic setup directly on comparison entry", () => {
  const html = renderToStaticMarkup(
    <SimulationProvider>
      <SimulationRuntime>
        <ScenarioProvider>
          <ComparisonProvider>
            <ComparisonWorkspace />
          </ComparisonProvider>
        </ScenarioProvider>
      </SimulationRuntime>
    </SimulationProvider>,
  );
  for (const label of [
    "Incident location",
    "Vehicle type",
    "Traffic density",
    "Start comparison",
    "Scenario selection map",
  ])
    expect(html).toContain(label);
  const its = html.match(
    /<div role="radiogroup" aria-label="Simulated ITS feedback".*?<\/div>/,
  )?.[0];
  expect(its).toContain('role="radio"');
  expect(its).not.toContain('disabled=""');
  expect(html).not.toContain("Choose incident and station</a>");
  expect(html).toContain("Focus Mode");
  expect(html).not.toContain("Exit Focus");
  expect(html).toMatch(/data-testid="start-corridor"[^>]*disabled/);
});
