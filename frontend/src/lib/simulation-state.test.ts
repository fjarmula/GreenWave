import { describe, expect, it } from "vitest";

import { initialSimulationState, simulationReducer } from "@/lib/simulation-state";
import type {
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTick,
} from "@/types/telemetry";

const request: SimulationStartRequest = {
  simulation_id: "test-simulation",
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0134, lng: 19.9982 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
};

const route: SimulationStartResponse = {
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
  intersections_on_route: ["INT-302"],
};

const tick: SimulationTick = {
  event_type: "SIMULATION_TICK",
  tick: 1,
  timestamp: "2026-10-14T12:00:00Z",
  ambulance: {
    id: "AMB-KRA-01",
    position: request.origin,
    speed_kmh: 62.4,
    status: "APPROACHING_INTERSECTION",
  },
  kpi_metrics: { current_time_saved_sec: 1, total_time_elapsed_sec: 1 },
  intersections: [
    {
      id: "INT-302",
      name: "Test intersection",
      state: "CLEARING",
      tti_seconds: 28,
      is_active_corridor: true,
    },
  ],
};

describe("simulation state lifecycle", () => {
  it("starts with the initialization payload, accepts ticks and preserves the final snapshot", () => {
    const running = simulationReducer(initialSimulationState, {
      type: "START",
      request,
      routeData: route,
    });
    expect(running.simulationState).toBe("RUNNING");
    expect(running.routeData).toEqual(route);
    expect(running.startRequest).toEqual(request);
    const updated = simulationReducer(running, { type: "TICK", telemetry: tick });
    const finished = simulationReducer(updated, { type: "FINISH" });
    expect(finished.simulationState).toBe("FINISHED");
    expect(finished.liveTelemetry).toEqual(tick);
    expect(simulationReducer(finished, { type: "RESET" })).toEqual(initialSimulationState);
  });

  it("does not accept ticks outside a running simulation", () => {
    expect(simulationReducer(initialSimulationState, { type: "TICK", telemetry: tick })).toBe(
      initialSimulationState,
    );
    const running = simulationReducer(initialSimulationState, {
      type: "START",
      request,
      routeData: route,
    });
    const finished = simulationReducer(running, { type: "FINISH" });
    expect(simulationReducer(finished, { type: "TICK", telemetry: tick })).toBe(finished);
  });

  it("clears the previous telemetry when starting another simulation", () => {
    const running = simulationReducer(initialSimulationState, {
      type: "START",
      request,
      routeData: route,
    });
    const updated = simulationReducer(running, { type: "TICK", telemetry: tick });
    const restarted = simulationReducer(updated, {
      type: "START",
      request: { ...request, simulation_id: "next" },
      routeData: route,
    });
    expect(restarted.liveTelemetry).toBeNull();
    expect(restarted.startRequest?.simulation_id).toBe("next");
  });
});
