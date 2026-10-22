import { describe, expect, it } from "vitest";

import { nextPreviousRun, toPreviousRun, type PreviousRun } from "@/lib/previous-run";
import {
  initialSimulationState,
  simulationReducer,
  type SimulationAction,
  type SimulationState,
} from "@/lib/simulation-state";
import type { SimulationStartRequest, SimulationStartResponse } from "@/types/telemetry";

const SIMULATION_ID = "test-simulation";

const request: SimulationStartRequest = {
  green_wave_mode: "DISABLED",
  simulation_id: SIMULATION_ID,
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0134, lng: 19.9982 },
  traffic_density_multiplier: 2,
  enable_cascade_mode: true,
  playback_speed: 10,
  vehicle_type: "AMBULANCE",
};

const route: SimulationStartResponse = {
  green_wave_mode: "DISABLED",
  schema_version: "1.0",
  is_simulated: true,
  simulation_id: SIMULATION_ID,
  status: "INITIALIZED",
  route_geometry: {
    type: "LineString",
    coordinates: [
      [19.9571, 50.0612],
      [19.9982, 50.0134],
    ],
  },
  total_distance_m: 5400,
  estimated_normal_time_sec: 780,
  estimated_greenwave_time_sec: 380,
  intersections_on_route: [],
  route_intersections: [],
  origin_snapped: { position: { lat: 50.0612, lng: 19.9571 }, snap_distance_m: 0 },
  destination_snapped: { position: { lat: 50.0134, lng: 19.9982 }, snap_distance_m: 0 },
};

function reduce(...actions: SimulationAction[]): SimulationState {
  return actions.reduce(simulationReducer, initialSimulationState);
}

const started: SimulationAction[] = [
  { type: "START_REQUESTED", request },
  { type: "START_SUCCEEDED", simulationId: SIMULATION_ID, response: route },
];

const finished = reduce(...started, {
  type: "TERMINAL",
  event: {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_COMPLETED",
    simulation_id: SIMULATION_ID,
    tick: 812,
    timestamp: "2026-10-22T12:00:00Z",
    kpi_metrics: { total_time_elapsed_sec: 812, current_time_saved_sec: -32 },
  },
});

const stopped = reduce(...started, { type: "STOP_CONFIRMED", simulationId: SIMULATION_ID });

const EARLIER: PreviousRun = {
  greenWaveMode: "ENABLED",
  totalSeconds: 400,
  savedSeconds: 380,
  normalEstimateSeconds: 780,
  stationName: "Earlier station",
  incidentLabel: "Earlier incident",
  trafficDensity: 1.5,
};

describe("toPreviousRun", () => {
  it("records a finished run from its request, route and final KPIs", () => {
    expect(toPreviousRun(finished, "Stacja 1", "Rynek Główny 1")).toEqual({
      greenWaveMode: "DISABLED",
      totalSeconds: 812,
      savedSeconds: -32,
      normalEstimateSeconds: 780,
      stationName: "Stacja 1",
      incidentLabel: "Rynek Główny 1",
      trafficDensity: 2,
    });
  });

  it.each([
    ["SETUP", initialSimulationState],
    ["STARTING", reduce(started[0])],
    ["RUNNING", reduce(...started)],
    ["CANCELLED", stopped],
    [
      "ERROR",
      reduce(...started, {
        type: "ERROR",
        simulationId: SIMULATION_ID,
        error: { kind: "network", message: "lost" },
      }),
    ],
  ])("records nothing for a %s run", (phase, state) => {
    expect(state.simulationState).toBe(phase);
    expect(toPreviousRun(state, "Stacja 1", "Rynek Główny 1")).toBeNull();
  });
});

describe("nextPreviousRun", () => {
  it("replaces the previous run with a newly finished one", () => {
    expect(nextPreviousRun(EARLIER, finished, "Stacja 1", "Rynek Główny 1")?.greenWaveMode).toBe(
      "DISABLED",
    );
  });

  it("keeps the previous run when the run being left did not finish", () => {
    expect(nextPreviousRun(EARLIER, stopped, "Stacja 1", "Rynek Główny 1")).toBe(EARLIER);
    expect(nextPreviousRun(null, stopped, "Stacja 1", "Rynek Główny 1")).toBeNull();
  });
});
