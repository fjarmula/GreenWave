import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/components/dashboard";
import { SimulationRuntime } from "@/components/simulation-runtime";
import { ScenarioProvider } from "@/components/scenario-provider";
import { SimulationProvider } from "@/components/simulation-provider";
import type { SimulationTransport } from "@/lib/config";
import { request, route, tick } from "@/lib/comparison/fixtures.test-support";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";

const transport = vi.hoisted(() => ({ current: "mock" as SimulationTransport }));
const phone = vi.hoisted(() => ({ current: false }));

vi.mock("@/lib/useIsPhone", () => ({ useIsPhone: () => phone.current }));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getFrontendConfig: () => ({
      ...actual.parseFrontendConfig({ transport: transport.current }, () => undefined),
    }),
  };
});

// MapLibre needs a browser; the map itself is covered by the browser check.
vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: ({ live }: { live: boolean }) => <div data-testid="map" data-live={String(live)} />,
}));

describe.each(["mock", "backend"] as const)("Dashboard setup markup (%s transport)", (name) => {
  it("matches the recorded markup", async () => {
    transport.current = name;
    phone.current = false;
    const markup = renderToStaticMarkup(
      <SimulationProvider>
        <SimulationRuntime>
          <ScenarioProvider>
            <Dashboard />
          </ScenarioProvider>
        </SimulationRuntime>
      </SimulationProvider>,
    );
    await expect(`${markup}\n`).toMatchFileSnapshot(`./__snapshots__/Dashboard.setup.${name}.html`);
  });
});

const live: SimulationState = {
  ...initialSimulationState,
  simulationState: "RUNNING",
  startRequest: request,
  routeData: route(),
  liveTelemetry: tick(3),
  lastTick: 3,
  connection: "open",
};
const renderDashboard = (state: SimulationState) =>
  renderToStaticMarkup(
    <SimulationProvider initialState={state}>
      <SimulationRuntime>
        <ScenarioProvider>
          <Dashboard selectedMode="ENABLED" />
        </ScenarioProvider>
      </SimulationRuntime>
    </SimulationProvider>,
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("Green Wave workspace sheet", () => {
  it("renders one stop control in the live green wave workspace", () => {
    transport.current = "mock";
    for (const isPhone of [false, true]) {
      phone.current = isPhone;
      const html = renderDashboard(live);
      expect(count(html, /data-testid="(stop-simulation|driver-stop)"/g)).toBe(1);
    }
  });
  it("puts the live run in a bottom sheet on phones", () => {
    transport.current = "mock";
    phone.current = true;
    const html = renderDashboard(live);
    expect(html).toContain("bottom-sheet");
    expect(html).toContain('aria-label="Simulation telemetry"');
    expect(html).toContain("Route signals");
  });
  it("sets up from the sheet on phones without duplicate fields", () => {
    transport.current = "mock";
    phone.current = true;
    const html = renderDashboard(initialSimulationState);
    expect(html).toContain("bottom-sheet");
    expect(count(html, /data-testid="start-corridor"/g)).toBe(1);
    expect(count(html, /id="incident"/g)).toBe(1);
    expect(html).toContain("Initialize green corridor");
  });
});

describe("while a comparison owns the simulation", () => {
  it("points back to the live comparison, not a recording", async () => {
    const { simulationOperationSlot } = await import("@/lib/operation-slot");
    transport.current = "mock";
    phone.current = false;
    simulationOperationSlot.acquire("comparison");
    try {
      const html = renderDashboard(initialSimulationState);
      expect(html).toContain("A comparison owns the simulation.");
      expect(html).toContain("Return to the comparison");
      expect(html).not.toContain("recording");
    } finally {
      simulationOperationSlot.release("comparison");
    }
  });
});
