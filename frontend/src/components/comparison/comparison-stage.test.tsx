import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComparisonStage } from "./ComparisonStage";
import { completed, request, route, tick } from "@/lib/comparison/fixtures.test-support";
import type { LiveComparisonState } from "@/lib/comparison/live-comparison";
import type { ComparisonMode } from "@/lib/comparison/race";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";

vi.mock("@/components/map/MapContainer", () => ({
  MapContainer: () => <div data-testid="pane-map" />,
}));

const line = (mode: ComparisonMode) => ({
  ...route(mode === "ENABLED" ? "pair-e" : "pair-d", mode),
  route_geometry: {
    type: "LineString" as const,
    coordinates: [
      [19.9, 50.0],
      [19.95, 50.0],
    ] as [number, number][],
  },
});
const run = (mode: ComparisonMode, lng: number): SimulationState => ({
  ...initialSimulationState,
  simulationState: "RUNNING",
  startRequest: { ...request, green_wave_mode: mode },
  routeData: line(mode),
  connection: "open",
  lastTick: 30,
  liveTelemetry: { ...tick(30), ambulance: { ...tick(30).ambulance, position: { lat: 50, lng } } },
});
const arrived = (mode: ComparisonMode, seconds: number): SimulationState => ({
  ...run(mode, 19.95),
  simulationState: "FINISHED",
  connection: null,
  completion: completed(seconds),
});
const running: LiveComparisonState = {
  status: "running",
  runs: { ENABLED: run("ENABLED", 19.93), DISABLED: run("DISABLED", 19.92) },
  priorityIds: ["INT-0360"],
  reason: null,
  stopping: false,
};
const render = (state: LiveComparisonState) =>
  renderToStaticMarkup(
    <ComparisonStage
      state={state}
      pane="ENABLED"
      onPaneChange={() => {}}
      onStop={() => {}}
      onReset={() => {}}
    />,
  );
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("comparison stage", () => {
  it("shows both live panes, the race readout and exactly one Stop", () => {
    const html = render(running);
    expect(html).toContain("Green Wave");
    expect(html).toContain("Standard traffic");
    expect(count(html, /data-testid="pane-map"/g)).toBe(2);
    expect(html).toMatch(/Green Wave ahead by \d+ m/);
    expect(count(html, /data-testid="comparison-stop"/g)).toBe(1);
    expect(html).toContain("km/h");
    expect(html).toContain("left");
  });

  it("offers a phone toggle between the panes", () => {
    const html = render(running);
    expect(html).toContain("comparison-phone-toggle");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Green Wave/);
  });

  it("ends on a result card without Stop, replay or scrubbing", () => {
    const html = render({
      ...running,
      status: "finished",
      runs: { ENABLED: arrived("ENABLED", 300), DISABLED: arrived("DISABLED", 345) },
      priorityIds: ["INT-0360", "INT-0366"],
    });
    expect(html).toContain("Green Wave faster");
    expect(html).toContain("05m 00s");
    expect(html).toContain("05m 45s");
    expect(html).toContain("00m 45s");
    expect(html).toContain("Signals given priority 2 of 2");
    expect(html).toContain("New comparison");
    expect(count(html, /data-testid="comparison-stop"/g)).toBe(0);
    for (const text of ["Play", "Restart", 'type="range"']) expect(html).not.toContain(text);
  });

  it("marks the stopped run when the comparison was stopped after one arrival", () => {
    const html = render({
      ...running,
      status: "finished",
      runs: {
        ENABLED: arrived("ENABLED", 300),
        DISABLED: {
          ...run("DISABLED", 19.94),
          simulationState: "CANCELLED",
          cancelReason: "STOPPED",
        },
      },
    });
    expect(html).toContain("Comparison stopped");
    expect(html).toContain("05m 00s");
    expect(html).toContain("Stopped");
  });

  it("shows why a comparison was cancelled", () => {
    const html = render({
      ...running,
      status: "cancelled",
      reason: "Comparison replaced by another simulation",
    });
    expect(html).toContain("Comparison replaced by another simulation");
    expect(html).toContain("New comparison");
    expect(count(html, /data-testid="comparison-stop"/g)).toBe(0);
  });
});
