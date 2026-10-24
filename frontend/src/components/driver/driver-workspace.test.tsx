import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DriverWorkspace } from "@/components/driver/DriverWorkspace";
import { ScenarioProvider } from "@/components/scenario-provider";
import { SimulationProvider } from "@/components/simulation-provider";
import { SimulationRuntime } from "@/components/simulation-runtime";
import { completed, request, route, tick } from "@/lib/comparison/fixtures.test-support";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";

// MapLibre needs a browser; the map itself is covered by the browser check.
vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: ({ live }: { live: boolean }) => <div data-testid="map" data-live={String(live)} />,
}));

const base = route();
const [first, second] = base.route_intersections;
// A straight route starting at the vehicle, so the next signal is 184 m ahead.
const liveRoute = {
  ...base,
  route_geometry: {
    type: "LineString" as const,
    coordinates: [
      [19.9, 50.0],
      [19.95, 50.0],
    ] as [number, number][],
  },
  route_intersections: [
    { ...first, distance_along_route_m: 184 },
    { ...second, distance_along_route_m: 900 },
  ],
};
const liveTick = {
  ...tick(12),
  ambulance: { ...tick(12).ambulance, position: { lat: 50.0, lng: 19.9 } },
  intersections: tick(12).intersections.map((intersection, index) => ({
    ...intersection,
    state: index === 0 ? ("PRIORITY_GREEN" as const) : intersection.state,
  })),
};
const running: SimulationState = {
  ...initialSimulationState,
  simulationState: "RUNNING",
  startRequest: request,
  routeData: liveRoute,
  liveTelemetry: liveTick,
  lastTick: 12,
  connection: "open",
};

const render = (state: SimulationState) =>
  renderToStaticMarkup(
    <SimulationProvider initialState={state}>
      <SimulationRuntime>
        <ScenarioProvider>
          <DriverWorkspace />
        </ScenarioProvider>
      </SimulationRuntime>
    </SimulationProvider>,
  );
const stopControls = (html: string) =>
  (html.match(/data-testid="(driver-stop|stop-simulation)"/g) ?? []).length;

describe("driver workspace", () => {
  it("opens on the incident setup card with a settings summary", () => {
    const html = render(initialSimulationState);
    expect(html).toContain("Where’s the incident?");
    expect(html).toMatch(/Traffic [\d.]+× · Cascade on · 1× speed/);
    expect(html).toContain("Initialize green corridor");
    expect(stopControls(html)).toBe(0);
  });

  it("shows exactly one stop control while running", () => {
    expect(stopControls(render(running))).toBe(1);
  });

  it("collapses setup and hides dispatch controls once running", () => {
    const html = render(running);
    expect(html).not.toContain("Initialize green corridor");
    expect(html).not.toContain("Where’s the incident?");
    expect(html).toContain("Dispatch settings");
    expect(html).toContain("145 s faster · simulated");
  });

  it("shows the next signal card with friendly copy", () => {
    const html = render(running);
    expect(html).toContain("Green in 180 m");
    expect(html).toContain(first.name);
  });

  it("hides the next signal card while telemetry is stale", () => {
    const html = render({ ...running, connection: "reconnecting" });
    expect(html).not.toContain("Green in");
    expect(html).toContain("Last received speed");
  });

  it("terminal replaces stop", () => {
    const html = render({
      ...running,
      simulationState: "FINISHED",
      connection: null,
      completion: completed(380),
    });
    expect(stopControls(html)).toBe(0);
    expect(html).toContain("Back to setup");
    expect(html).not.toContain("Dispatch settings");
  });
});
