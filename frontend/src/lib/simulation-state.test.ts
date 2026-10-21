import { describe, expect, it } from "vitest";

import {
  initialSimulationState,
  isTelemetryStale,
  simulationReducer,
  type SimulationAction,
  type SimulationState,
} from "@/lib/simulation-state";
import type {
  ItsDispatchEvent,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

const SIMULATION_ID = "test-simulation";

const request: SimulationStartRequest = {
  green_wave_mode: "ENABLED",
  simulation_id: SIMULATION_ID,
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0134, lng: 19.9982 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  playback_speed: 1,
  vehicle_type: "AMBULANCE",
};

const route: SimulationStartResponse = {
  green_wave_mode: "ENABLED",
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
  intersections_on_route: ["INT-0360"],
  route_intersections: [
    {
      id: "INT-0360",
      name: null,
      kind: "signalised_junction",
      position: { lat: 50.04, lng: 19.97 },
      distance_along_route_m: 1480,
      signal_count: 1,
      approach_count: 1,
      needs_review: false,
      cascade_targets: [],
    },
  ],
  origin_snapped: { position: { lat: 50.0612, lng: 19.9571 }, snap_distance_m: 0 },
  destination_snapped: { position: { lat: 50.0134, lng: 19.9982 }, snap_distance_m: 0 },
};

function tick(n: number, simulationId = SIMULATION_ID): SimulationTickEvent {
  return {
    signal_phases: [],
    schema_version: "1.0",
    is_simulated: true,
    simulation_id: simulationId,
    event_type: "SIMULATION_TICK",
    tick: n,
    timestamp: "2026-10-14T12:00:00Z",
    ambulance: {
      id: "AMB-KRA-01",
      position: request.origin,
      speed_kmh: 62.4,
      status: "APPROACHING_INTERSECTION",
    },
    kpi_metrics: { current_time_saved_sec: n, total_time_elapsed_sec: n },
    intersections: [
      {
        id: "INT-0360",
        name: null,
        state: "CLEARING",
        is_cascade: false,
        tti_seconds: 28,
        is_active_corridor: true,
      },
    ],
  };
}

function itsDispatch(n: number, messageId = `MSG-ITS-${n}`): ItsDispatchEvent {
  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "ITS_DISPATCH",
    message_id: messageId,
    simulation_id: SIMULATION_ID,
    tick: n,
    timestamp: "2026-10-25T14:31:58Z",
    system_source: "ER_GREENWAVE_ENGINE",
    target_system: "STeR_KRAKOW_ITS",
    payload: {
      priority_level: 1,
      vehicle_type: "AMBULANCE",
      intersections_group: ["INT-0360", "INT-0366"],
      action: "FORCE_GREEN_PHASE",
      hold_duration_sec: 55,
      expected_arrival_utc: "2026-10-25T14:32:38Z",
    },
  };
}

function reduce(state: SimulationState, ...actions: SimulationAction[]): SimulationState {
  return actions.reduce(simulationReducer, state);
}

const running = reduce(
  initialSimulationState,
  { type: "START_REQUESTED", request },
  { type: "START_SUCCEEDED", simulationId: SIMULATION_ID, response: route },
);

describe("simulation start", () => {
  it("enters STARTING, then RUNNING with route data and a connecting stream", () => {
    const starting = reduce(initialSimulationState, { type: "START_REQUESTED", request });
    expect(starting.simulationState).toBe("STARTING");
    expect(starting.startRequest).toEqual(request);
    expect(running.simulationState).toBe("RUNNING");
    expect(running.routeData).toEqual(route);
    expect(running.connection).toBe("connecting");
  });

  it("START_FAILED moves to ERROR with the error code", () => {
    const failed = reduce(
      initialSimulationState,
      { type: "START_REQUESTED", request },
      {
        type: "START_FAILED",
        simulationId: SIMULATION_ID,
        error: { kind: "http", status: 422, code: "NO_ROUTE", message: "no route" },
      },
    );
    expect(failed.simulationState).toBe("ERROR");
    expect(failed.error?.code).toBe("NO_ROUTE");
  });

  it("ignores a start result that belongs to an abandoned run", () => {
    const secondRequest = { ...request, simulation_id: "run-2" };
    const state = reduce(
      initialSimulationState,
      { type: "START_REQUESTED", request },
      { type: "RESET" },
      { type: "START_REQUESTED", request: secondRequest },
      { type: "START_SUCCEEDED", simulationId: SIMULATION_ID, response: route },
    );
    expect(state.simulationState).toBe("STARTING");
    expect(state.startRequest?.simulation_id).toBe("run-2");
    expect(state.routeData).toBeNull();
  });
});

describe("stream events", () => {
  it("accepts increasing ticks and marks the stream open", () => {
    const state = reduce(
      running,
      { type: "TICK", event: tick(1) },
      { type: "TICK", event: tick(2) },
    );
    expect(state.liveTelemetry?.tick).toBe(2);
    expect(state.lastTick).toBe(2);
  });

  it("ignores a TICK with tick <= the last tick", () => {
    const afterTwo = reduce(running, { type: "TICK", event: tick(2) });
    expect(reduce(afterTwo, { type: "TICK", event: tick(2) })).toBe(afterTwo);
    expect(reduce(afterTwo, { type: "TICK", event: tick(1) })).toBe(afterTwo);
  });

  it("ignores a TICK from another simulation_id", () => {
    expect(reduce(running, { type: "TICK", event: tick(1, "other") })).toBe(running);
  });

  it("ignores stream events outside RUNNING", () => {
    expect(reduce(initialSimulationState, { type: "TICK", event: tick(1) })).toBe(
      initialSimulationState,
    );
  });

  it("ITS_DISPATCH appends one formatted, simulated log line", () => {
    const state = reduce(running, { type: "ITS_DISPATCH", event: itsDispatch(1) });
    expect(state.itsLog).toEqual([
      {
        messageId: "MSG-ITS-1",
        text: "Simulated FORCE_GREEN_PHASE → INT-0360, INT-0366 · hold 55 s · ETA 14:32:38Z",
      },
    ]);
  });

  it("drops a repeated ITS_DISPATCH and one older than the last tick", () => {
    const once = reduce(running, { type: "ITS_DISPATCH", event: itsDispatch(3) });
    expect(reduce(once, { type: "ITS_DISPATCH", event: itsDispatch(3) })).toBe(once);
    const afterTick = reduce(running, { type: "TICK", event: tick(5) });
    expect(reduce(afterTick, { type: "ITS_DISPATCH", event: itsDispatch(4, "MSG-ITS-9") })).toBe(
      afterTick,
    );
  });

  it("bounds the ITS log to 20 entries", () => {
    const actions: SimulationAction[] = Array.from({ length: 25 }, (_, index) => ({
      type: "ITS_DISPATCH",
      event: itsDispatch(index + 1),
    }));
    const state = reduce(running, ...actions);
    expect(state.itsLog).toHaveLength(20);
    expect(state.itsLog[0].messageId).toBe("MSG-ITS-6");
  });

  it("CONNECTION updates the connection status of the current run only", () => {
    const open = reduce(running, {
      type: "CONNECTION",
      simulationId: SIMULATION_ID,
      status: "open",
    });
    expect(open.connection).toBe("open");
    expect(
      reduce(open, { type: "CONNECTION", simulationId: "other", status: "reconnecting" }),
    ).toBe(open);
  });
});

describe("D3 stream ordering", () => {
  it("accepts ITS(N) → TICK(N), drops a replayed ITS(N)/TICK(N), accepts TERMINAL(N)", () => {
    const state = reduce(
      running,
      { type: "ITS_DISPATCH", event: itsDispatch(5) },
      { type: "TICK", event: tick(5) },
      { type: "ITS_DISPATCH", event: itsDispatch(5, "MSG-ITS-REPLAY") },
      { type: "TICK", event: tick(5) },
      {
        type: "TERMINAL",
        event: {
          schema_version: "1.0",
          is_simulated: true,
          event_type: "SIMULATION_COMPLETED",
          simulation_id: SIMULATION_ID,
          tick: 5,
          timestamp: "2026-10-25T14:37:51Z",
          kpi_metrics: { current_time_saved_sec: 5, total_time_elapsed_sec: 5 },
        },
      },
    );
    expect(state.itsLog.map((entry) => entry.messageId)).toEqual(["MSG-ITS-5"]);
    expect(state.lastTick).toBe(5);
    expect(state.simulationState).toBe("FINISHED");
  });

  it("accepts a terminal event older than the last tick: it is final for the run", () => {
    const afterSix = reduce(running, { type: "TICK", event: tick(6) });
    const stale = reduce(afterSix, {
      type: "TERMINAL",
      event: {
        schema_version: "1.0",
        is_simulated: true,
        event_type: "SIMULATION_CANCELLED",
        simulation_id: SIMULATION_ID,
        tick: 5,
        timestamp: "2026-10-25T14:32:25Z",
        reason: "STOPPED",
      },
    });
    expect(stale.simulationState).toBe("CANCELLED");
    expect(stale.liveTelemetry?.tick).toBe(6);
  });
});

describe("terminal events", () => {
  it("SIMULATION_COMPLETED → FINISHED keeps the route and the last telemetry", () => {
    const withTick = reduce(running, { type: "TICK", event: tick(7) });
    const finished = reduce(withTick, {
      type: "TERMINAL",
      event: {
        schema_version: "1.0",
        is_simulated: true,
        event_type: "SIMULATION_COMPLETED",
        simulation_id: SIMULATION_ID,
        tick: 7,
        timestamp: "2026-10-25T14:37:51Z",
        kpi_metrics: { current_time_saved_sec: 396, total_time_elapsed_sec: 383 },
      },
    });
    expect(finished.simulationState).toBe("FINISHED");
    expect(finished.routeData).toEqual(route);
    expect(finished.liveTelemetry?.tick).toBe(7);
    expect(finished.completion?.kpi_metrics.current_time_saved_sec).toBe(396);
    expect(finished.connection).toBeNull();
  });

  it("SIMULATION_CANCELLED{SUPERSEDED} → CANCELLED with the reason", () => {
    const cancelled = reduce(running, {
      type: "TERMINAL",
      event: {
        schema_version: "1.0",
        is_simulated: true,
        event_type: "SIMULATION_CANCELLED",
        simulation_id: SIMULATION_ID,
        tick: 0,
        timestamp: "2026-10-25T14:32:25Z",
        reason: "SUPERSEDED",
      },
    });
    expect(cancelled.simulationState).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("SUPERSEDED");
  });

  it("ERROR during a run → ERROR with a lost connection, keeping the last snapshot", () => {
    const withTick = reduce(running, { type: "TICK", event: tick(3) });
    const lost = reduce(withTick, {
      type: "ERROR",
      simulationId: SIMULATION_ID,
      error: { kind: "http", status: 404, code: "SIMULATION_NOT_FOUND", message: "gone" },
    });
    expect(lost.simulationState).toBe("ERROR");
    expect(lost.connection).toBe("lost");
    expect(lost.liveTelemetry?.tick).toBe(3);
    expect(reduce(lost, { type: "TICK", event: tick(4) })).toBe(lost);
  });
});

describe("reset", () => {
  it("returns to SETUP from any state", () => {
    const states = [
      running,
      reduce(initialSimulationState, { type: "START_REQUESTED", request }),
      reduce(running, {
        type: "ERROR",
        simulationId: SIMULATION_ID,
        error: { kind: "network", message: "down" },
      }),
      reduce(running, {
        type: "TERMINAL",
        event: {
          schema_version: "1.0",
          is_simulated: true,
          event_type: "SIMULATION_COMPLETED",
          simulation_id: SIMULATION_ID,
          tick: 0,
          timestamp: "2026-10-25T14:37:51Z",
          kpi_metrics: { current_time_saved_sec: 0, total_time_elapsed_sec: 0 },
        },
      }),
      reduce(running, {
        type: "TERMINAL",
        event: {
          schema_version: "1.0",
          is_simulated: true,
          event_type: "SIMULATION_CANCELLED",
          simulation_id: SIMULATION_ID,
          tick: 0,
          timestamp: "2026-10-25T14:32:25Z",
          reason: "STOPPED",
        },
      }),
    ];
    expect(states.map((state) => state.simulationState)).toEqual([
      "RUNNING",
      "STARTING",
      "ERROR",
      "FINISHED",
      "CANCELLED",
    ]);
    for (const state of states) {
      expect(reduce(state, { type: "RESET" })).toEqual(initialSimulationState);
    }
  });
});

describe("isTelemetryStale", () => {
  it("is stale only when telemetry was flowing and stopped", () => {
    expect(isTelemetryStale({ simulationState: "RUNNING", connection: "open" })).toBe(false);
    expect(isTelemetryStale({ simulationState: "RUNNING", connection: "connecting" })).toBe(false);
    expect(isTelemetryStale({ simulationState: "RUNNING", connection: "reconnecting" })).toBe(true);
    expect(isTelemetryStale({ simulationState: "ERROR", connection: "lost" })).toBe(true);
    expect(isTelemetryStale({ simulationState: "FINISHED", connection: null })).toBe(false);
  });
});
