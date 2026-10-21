import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VehicleTelemetry } from "@/components/dashboard/VehicleTelemetry";
import { KpiHeader } from "@/components/hud/KpiHeader";
import {
  initialSimulationState,
  type SimulationPhase,
  type SimulationState,
} from "@/lib/simulation-state";
import type { SimulationTickEvent } from "@/types/telemetry";

let state: SimulationState = initialSimulationState;
vi.mock("@/components/simulation-provider", () => ({ useSimulationState: () => state }));

function lastTick(speedKmh: number, status: "EN_ROUTE" | "ARRIVED"): SimulationTickEvent {
  return {
    schema_version: "1.0",
    is_simulated: true,
    simulation_id: "test-simulation",
    event_type: "SIMULATION_TICK",
    tick: 42,
    timestamp: "2026-10-21T12:00:00Z",
    ambulance: {
      id: "AMB-KRA-01",
      position: { lat: 50.06, lng: 19.94 },
      speed_kmh: speedKmh,
      status,
    },
    kpi_metrics: { current_time_saved_sec: 12, total_time_elapsed_sec: 42 },
    intersections: [],
    signal_phases: [],
  };
}

function withRun(phase: SimulationPhase, telemetry: SimulationTickEvent | null) {
  state = {
    ...initialSimulationState,
    simulationState: phase,
    liveTelemetry: telemetry,
    lastTick: 42,
  };
}

const DISPLAYS = [
  ["KPI strip", () => renderToStaticMarkup(<KpiHeader />)],
  ["vehicle card", () => renderToStaticMarkup(<VehicleTelemetry />)],
] as const;

describe.each(DISPLAYS)("%s speed", (_name, render) => {
  beforeEach(() => {
    state = initialSimulationState;
  });

  it("shows the last interval speed while running", () => {
    withRun("RUNNING", lastTick(54.2, "EN_ROUTE"));
    const markup = render();
    expect(markup).toContain("54.2");
    expect(markup).toContain("Speed during last simulated second");
  });

  it("shows 0.0 at destination even when the arrival tick moved", () => {
    withRun("FINISHED", lastTick(37.5, "ARRIVED"));
    const markup = render();
    expect(markup).not.toContain("37.5");
    expect(markup).toContain("0.0");
    expect(markup).toContain("At destination");
  });

  it.each(["CANCELLED", "ERROR"] as const)("claims no current speed when %s", (phase) => {
    withRun(phase, lastTick(54.2, "EN_ROUTE"));
    const markup = render();
    expect(markup).not.toContain("54.2");
    expect(markup).toContain("No current speed");
    // The retained sample still identifies the vehicle and its last tick.
    expect(markup).toContain("AMB-KRA-01");
  });
});
