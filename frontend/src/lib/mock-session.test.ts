import { describe, expect, it } from "vitest";
import {
  advanceMockSession,
  buildMockDispatch,
  buildMockTick,
  createMockSession,
  type MockSession,
  stepMockSignals,
} from "@/lib/mock-session";
import {
  MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
  MOCK_SAMPLE_INTERSECTIONS,
  MOCK_SIGNAL_GREEN_SECONDS,
  MOCK_SIGNAL_YELLOW_SECONDS,
  MOCK_STANDARD_CLEARANCE_SECONDS,
} from "@/lib/mock-simulation-config";
import type {
  GreenWaveMode,
  ItsDispatchEvent,
  SimulationStartRequest,
  SimulationTickEvent,
} from "@/types/telemetry";

function requestWithCascade(enableCascadeMode: boolean): SimulationStartRequest {
  return {
    green_wave_mode: "ENABLED",
    simulation_id: "cascade",
    origin: { lat: 50.06, lng: 19.95 },
    destination: { lat: 50.07, lng: 19.96 },
    traffic_density_multiplier: 1,
    enable_cascade_mode: enableCascadeMode,
    playback_speed: 1,
    vehicle_type: "AMBULANCE",
  };
}

// First sample signal arrives at 1480 / 5400 * 380 ≈ 104.1 s, so its TTI is ≤ 40 s at 65 s;
// the second (152 m further, TTI ≈ 49.8 s) is still outside its own clearing window.
const ELAPSED_WITH_FIRST_SIGNAL_CLEARING = 65;

describe("stepMockSignals", () => {
  it.each([
    [true, "CLEARING", true],
    [false, "NORMAL", false],
  ] as const)(
    "enters cascade targets within 250 m only when cascade is enabled (cascade %s)",
    (enableCascadeMode, nextState, nextIsCascade) => {
      const session = createMockSession(requestWithCascade(enableCascadeMode));
      session.elapsedSeconds = ELAPSED_WITH_FIRST_SIGNAL_CLEARING;
      const enteredClearing = new Set<number>();

      stepMockSignals(session, enteredClearing);

      expect(session.signals[0]).toMatchObject({ state: "CLEARING", isCascade: false });
      expect(session.signals[1]).toMatchObject({ state: nextState, isCascade: nextIsCascade });
      expect([...enteredClearing]).toEqual(enableCascadeMode ? [0, 1] : [0]);
    },
  );

  it("leaves every route cascade target empty when cascade mode is disabled", () => {
    const session = createMockSession(requestWithCascade(false));

    expect(
      session.route.route_intersections.map(({ cascade_targets: targets }) => targets),
    ).toEqual([[], []]);
  });
});

describe("buildMockDispatch", () => {
  it("reports the request's vehicle type in the ITS payload", () => {
    const session = createMockSession({ ...requestWithCascade(false), vehicle_type: "FIRE_TRUCK" });

    const event = buildMockDispatch(session, new Set([0]), "2026-10-20T12:00:00Z", 0);

    expect(event?.payload.vehicle_type).toBe("FIRE_TRUCK");
  });
});

function modeRequest(
  greenWaveMode: GreenWaveMode,
  patch: Partial<SimulationStartRequest> = {},
): SimulationStartRequest {
  return { ...requestWithCascade(true), green_wave_mode: greenWaveMode, ...patch };
}

function runToCompletion(session: MockSession) {
  const ticks: SimulationTickEvent[] = [];
  const dispatches: ItsDispatchEvent[] = [];
  for (let interval = 0; interval < 10_000; interval += 1) {
    const { tick, dispatch, completed } = advanceMockSession(session);
    ticks.push(tick);
    if (dispatch) dispatches.push(dispatch);
    if (completed) return { ticks, dispatches };
  }
  throw new Error("mock run never completed");
}

describe("ER Green Wave mode in the mock", () => {
  it.each(["ENABLED", "DISABLED"] as const)("echoes %s in the start response", (mode) => {
    expect(createMockSession(modeRequest(mode)).route.green_wave_mode).toBe(mode);
  });

  it("never dispatches or activates a corridor when disabled, even with cascade", () => {
    const { ticks, dispatches } = runToCompletion(createMockSession(modeRequest("DISABLED")));

    expect(dispatches).toEqual([]);
    for (const tick of ticks) {
      expect(tick.intersections.every((item) => item.state === "NORMAL")).toBe(true);
      expect(tick.intersections.some((item) => item.is_active_corridor)).toBe(false);
    }
  });

  it("keeps the open road identical and adds a density-scaled clearance per intersection", () => {
    const density = 2;
    const enabled = runToCompletion(
      createMockSession(modeRequest("ENABLED", { traffic_density_multiplier: density })),
    );
    const disabled = runToCompletion(
      createMockSession(modeRequest("DISABLED", { traffic_density_multiplier: density })),
    );

    // Before the first sample intersection (~104 s) both vehicles are in the same place.
    expect(disabled.ticks[60].ambulance.position).toEqual(enabled.ticks[60].ambulance.position);
    const clearance = MOCK_STANDARD_CLEARANCE_SECONDS * density;
    expect(disabled.ticks.at(-1)?.kpi_metrics.total_time_elapsed_sec).toBe(
      MOCK_GREENWAVE_TRAVEL_TIME_SECONDS + MOCK_SAMPLE_INTERSECTIONS.length * clearance,
    );
    expect(enabled.ticks.at(-1)?.kpi_metrics.total_time_elapsed_sec).toBe(
      MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
    );
  });

  it("reports a stopped vehicle crossing the intersection while it waits", () => {
    const { ticks } = runToCompletion(createMockSession(modeRequest("DISABLED")));
    const waiting = ticks[110]; // first intersection reached at ~104 s, clearance 35 s

    expect(waiting.ambulance).toMatchObject({ status: "CROSSING_INTERSECTION", speed_kmh: 0 });
    expect(waiting.intersections[0].tti_seconds).toBe(0);
  });
});

describe("mock signal phases", () => {
  const colors = (tick: SimulationTickEvent, intersectionId: string) =>
    Object.fromEntries(
      tick.signal_phases
        .filter((phase) => phase.intersection_id === intersectionId)
        .map((phase) => [`${phase.signal_key}/${phase.kind}`, phase.color]),
    );

  it("samples a vehicle and a pedestrian light per synthetic signal, labelled mock", () => {
    const session = createMockSession(modeRequest("DISABLED"));
    const tick = buildMockTick(session, "2026-10-21T00:00:00Z");

    expect(tick.signal_phases).toHaveLength(MOCK_SAMPLE_INTERSECTIONS.length * 4);
    for (const phase of tick.signal_phases) {
      expect(phase.accessible_label).toMatch(/^Simulated mock /);
      expect(phase.accessible_label.toLowerCase()).toContain(phase.color.toLowerCase());
      expect(Number.isFinite(phase.position.lat) && Number.isFinite(phase.position.lng)).toBe(true);
    }
    expect(colors(tick, "INT-0360")).toEqual({
      "INT-0360-S1/VEHICLE": "GREEN",
      "INT-0360-S1/PEDESTRIAN": "RED",
      "INT-0360-S2/VEHICLE": "RED",
      "INT-0360-S2/PEDESTRIAN": "GREEN",
    });
  });

  it("follows the same two-group cycle as the backend projection", () => {
    const session = createMockSession(modeRequest("DISABLED"));
    const at = (seconds: number) => {
      session.elapsedSeconds = seconds;
      return colors(buildMockTick(session, "2026-10-21T00:00:00Z"), "INT-0366");
    };

    expect(at(MOCK_SIGNAL_GREEN_SECONDS)["INT-0366-S1/VEHICLE"]).toBe("YELLOW");
    expect(at(MOCK_SIGNAL_GREEN_SECONDS + MOCK_SIGNAL_YELLOW_SECONDS)).toEqual({
      "INT-0366-S1/VEHICLE": "RED",
      "INT-0366-S1/PEDESTRIAN": "RED",
      "INT-0366-S2/VEHICLE": "RED",
      "INT-0366-S2/PEDESTRIAN": "RED",
    });
  });

  it("holds conflicts red and the route approach green during priority", () => {
    const session = createMockSession(modeRequest("ENABLED"));
    session.elapsedSeconds = 90; // first intersection TTI ~14 s: PRIORITY_GREEN
    stepMockSignals(session, new Set());
    session.signals[0].state = "PRIORITY_GREEN";

    expect(colors(buildMockTick(session, "2026-10-21T00:00:00Z"), "INT-0360")).toEqual({
      "INT-0360-S1/VEHICLE": "GREEN",
      "INT-0360-S1/PEDESTRIAN": "RED",
      "INT-0360-S2/VEHICLE": "RED",
      "INT-0360-S2/PEDESTRIAN": "RED",
    });
  });
});
