import { estimateMockRoute, haversineMeters } from "@/lib/mock-route-metrics";
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
  MOCK_REFERENCE_GREENWAVE_SECONDS,
  MOCK_ORDINARY_SPEED_LIMIT_MPS,
  MOCK_REFERENCE_DISTANCE_METERS,
  MOCK_SAMPLE_INTERSECTIONS,
  MOCK_SIGNAL_GREEN_SECONDS,
  MOCK_SIGNAL_YELLOW_SECONDS,
  MOCK_STANDARD_CLEARANCE_SECONDS,
  MOCK_STANDARD_CROSSING_DISTANCE_M,
  MOCK_MIN_INTERSECTION_DELAY_SECONDS,
  MOCK_MIN_ROLLING_SPEED_MPS,
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
    its_scenario: "NOMINAL" as const,
    simulation_id: "cascade",
    origin: { lat: 0, lng: 0 },
    destination: { lat: (5400 / 6_371_000) * (180 / Math.PI), lng: 0 },
    traffic_density_multiplier: 1,
    enable_cascade_mode: enableCascadeMode,
    playback_speed: 1,
    vehicle_type: "AMBULANCE",
  };
}

// Open road at 5400 / 374 m/s plus a 3 s rolling slowdown over the last 60 m: the first sample
// signal is reached at ≈ 105.5 s, so its TTI is ≤ 40 s at 66 s; the second (152 m further, ≈ 119 s)
// is still outside its own clearing window.
const ELAPSED_WITH_FIRST_SIGNAL_CLEARING = 66;

describe("stepMockSignals", () => {
  it.each([
    [true, "NORMAL", true],
    [false, "NORMAL", false],
  ] as const)(
    "enters cascade targets within 250 m only when cascade is enabled (cascade %s)",
    (enableCascadeMode, nextState, nextIsCascade) => {
      const session = createMockSession(requestWithCascade(enableCascadeMode));
      session.elapsedSeconds = ELAPSED_WITH_FIRST_SIGNAL_CLEARING;
      session.driveSeconds = ELAPSED_WITH_FIRST_SIGNAL_CLEARING;
      const enteredClearing = new Set<number>();

      stepMockSignals(session, enteredClearing);

      expect(session.signals[0]).toMatchObject({ state: "NORMAL", isCascade: false });
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

describe("mock vehicle id", () => {
  it.each([
    ["AMBULANCE", "AMB-KRA-01"],
    ["FIRE_TRUCK", "FIRE-KRA-01"],
    ["POLICE_CAR", "POL-KRA-01"],
  ] as const)("names the simulated %s like the backend (%s)", (vehicleType, expected) => {
    const session = createMockSession({ ...requestWithCascade(false), vehicle_type: vehicleType });

    expect(advanceMockSession(session).tick.ambulance.id).toBe(expected);
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

  it("leaves every cascade target empty when disabled, even with cascade requested", () => {
    const session = createMockSession(modeRequest("DISABLED"));

    expect(session.request.enable_cascade_mode).toBe(true);
    expect(session.route.route_intersections.map((item) => item.cascade_targets)).toEqual([[], []]);
  });

  const DENSITY = { traffic_density_multiplier: 1.5 };

  it("slows before each junction in Green Wave mode and keeps the trip time", () => {
    const session = createMockSession(modeRequest("ENABLED", DENSITY));
    const { legs, tripSeconds } = session.timeline;
    expect(tripSeconds).toBeCloseTo(MOCK_REFERENCE_GREENWAVE_SECONDS, 6);
    for (const junction of session.route.route_intersections) {
      const leg = legs.find(
        (item) =>
          Math.abs(
            item.startMeters +
              (item.endSeconds - item.startSeconds) * item.speedMps -
              junction.distance_along_route_m,
          ) < 1e-6,
      );
      expect(leg).toBeDefined();
      expect(leg?.crossing).toBe(true);
      expect(leg?.speedMps).toBeLessThan(AMBULANCE_MPS);
      expect(leg?.speedMps).toBeGreaterThanOrEqual(MOCK_MIN_ROLLING_SPEED_MPS);
    }
  });

  it("spends every D_min before arriving, whatever the route length", () => {
    // Near the rolling floor the slowdown would outrun the destination; it is cut there.
    for (let meters = 20; meters <= 3000; meters += 5) {
      const request = modeRequest("ENABLED", {
        ...DENSITY,
        destination: { lat: 0, lng: meters / 111_320 },
      });
      const expected = estimateMockRoute(
        request.origin,
        request.destination,
        request.traffic_density_multiplier,
      ).greenwaveSeconds;
      expect(createMockSession(request).timeline.tripSeconds).toBeCloseTo(expected, 6);
    }
  });

  it("never reports 0 km/h in Green Wave mode", () => {
    const { ticks } = runToCompletion(createMockSession(modeRequest("ENABLED", DENSITY)));
    const driving = ticks.filter((tick) => tick.ambulance.status !== "ARRIVED");
    expect(driving.length).toBeGreaterThan(0);
    for (const tick of driving) expect(tick.ambulance.speed_kmh).toBeGreaterThan(0);
  });

  // Open road (both modes) at the ambulance speed: the Green Wave estimate minus its D_min.
  const AMBULANCE_MPS =
    MOCK_REFERENCE_DISTANCE_METERS /
    (MOCK_REFERENCE_GREENWAVE_SECONDS - 2 * MOCK_MIN_INTERSECTION_DELAY_SECONDS);
  const CAUTIOUS_SECONDS = MOCK_STANDARD_CLEARANCE_SECONDS * 1.5;
  const CROSSING_SECONDS =
    MOCK_STANDARD_CROSSING_DISTANCE_M / MOCK_ORDINARY_SPEED_LIMIT_MPS + CAUTIOUS_SECONDS;
  const FIRST_REACH_SECONDS =
    (MOCK_SAMPLE_INTERSECTIONS[0].routeFraction * MOCK_REFERENCE_DISTANCE_METERS) / AMBULANCE_MPS;

  it("keeps the open road identical and adds the cautious time only at a red crossing", () => {
    const enabled = runToCompletion(createMockSession(modeRequest("ENABLED", DENSITY)));
    const disabled = runToCompletion(createMockSession(modeRequest("DISABLED", DENSITY)));

    // Before the first sample intersection (~104 s) both vehicles are in the same place.
    expect(disabled.ticks[60].ambulance.position).toEqual(enabled.ticks[60].ambulance.position);
    const trip =
      MOCK_REFERENCE_GREENWAVE_SECONDS -
      2 * MOCK_MIN_INTERSECTION_DELAY_SECONDS +
      CROSSING_SECONDS -
      MOCK_STANDARD_CROSSING_DISTANCE_M / AMBULANCE_MPS; // INT-9002 is green: no second penalty
    const disabledArrival = disabled.ticks.findIndex((tick) => tick.ambulance.status === "ARRIVED");
    expect(disabled.ticks[disabledArrival].kpi_metrics.total_time_elapsed_sec).toBe(
      Math.round(trip),
    );
    expect(enabled.ticks.at(-1)?.kpi_metrics.total_time_elapsed_sec).toBe(
      MOCK_REFERENCE_GREENWAVE_SECONDS,
    );
  });

  it("rolls through a red crossing at a positive speed no faster than the ordinary limit", () => {
    const { ticks } = runToCompletion(createMockSession(modeRequest("DISABLED", DENSITY)));
    const crossing = ticks.filter((tick) => tick.ambulance.status === "CROSSING_INTERSECTION");

    // Only INT-9001's crossing: whole ticks between reaching it and leaving it.
    expect(crossing.map((tick) => tick.kpi_metrics.total_time_elapsed_sec)).toEqual(
      Array.from(
        {
          length:
            Math.ceil(FIRST_REACH_SECONDS + CROSSING_SECONDS) - Math.ceil(FIRST_REACH_SECONDS),
        },
        (_, index) => Math.ceil(FIRST_REACH_SECONDS) + index,
      ),
    );
    for (const [index, tick] of crossing.entries()) {
      expect(tick.ambulance.speed_kmh).toBeGreaterThan(0);
      expect(tick.ambulance.speed_kmh).toBeLessThanOrEqual(MOCK_ORDINARY_SPEED_LIMIT_MPS * 3.6);
      if (index > 0) {
        expect(tick.ambulance.position).not.toEqual(crossing[index - 1].ambulance.position);
      }
    }
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
    expect(colors(tick, "INT-9001")).toEqual({
      "INT-9001-S1/VEHICLE": "GREEN",
      "INT-9001-S1/PEDESTRIAN": "RED",
      "INT-9001-S2/VEHICLE": "RED",
      "INT-9001-S2/PEDESTRIAN": "GREEN",
    });
  });

  it("follows the same two-group cycle as the backend projection", () => {
    const session = createMockSession(modeRequest("DISABLED"));
    const at = (seconds: number) => {
      session.elapsedSeconds = seconds;
      session.controller.advance(seconds, [100, 100], [false, false], "2026-10-21T00:00:00Z");
      return colors(buildMockTick(session, "2026-10-21T00:00:00Z"), "INT-9002");
    };

    expect(at(MOCK_SIGNAL_GREEN_SECONDS)["INT-9002-S1/VEHICLE"]).toBe("YELLOW");
    expect(at(MOCK_SIGNAL_GREEN_SECONDS + MOCK_SIGNAL_YELLOW_SECONDS)).toEqual({
      "INT-9002-S1/VEHICLE": "RED",
      "INT-9002-S1/PEDESTRIAN": "RED",
      "INT-9002-S2/VEHICLE": "RED",
      "INT-9002-S2/PEDESTRIAN": "RED",
    });
  });

  it("holds conflicts red and the route approach green during priority", () => {
    const session = createMockSession(modeRequest("ENABLED"));
    session.elapsedSeconds = 90; // first intersection TTI ~14 s: PRIORITY_GREEN
    const dispatch = buildMockDispatch(session, new Set([0]), "2026-10-21T00:00:00Z", 0)!;
    session.controller.submit(dispatch, 89);
    session.controller.advance(90, [14, 30], [false, false], "2026-10-21T00:00:00Z");

    expect(colors(buildMockTick(session, "2026-10-21T00:00:00Z"), "INT-9001")).toEqual({
      "INT-9001-S1/VEHICLE": "GREEN",
      "INT-9001-S1/PEDESTRIAN": "RED",
      "INT-9001-S2/VEHICLE": "RED",
      "INT-9001-S2/PEDESTRIAN": "RED",
    });
  });
});

describe("mock signal light sequence", () => {
  const LEGAL = new Set(["GREEN>YELLOW", "YELLOW>RED", "RED>GREEN"]);

  it.each([1, 2, 3])(
    "only changes vehicle lights GREEN→YELLOW→RED→GREEN across ticks (density %s)",
    (density) => {
      const { ticks } = runToCompletion(
        createMockSession(modeRequest("ENABLED", { traffic_density_multiplier: density })),
      );
      let previous = new Map<string, string>();
      let changes = 0;
      for (const tick of ticks) {
        const current = new Map(
          tick.signal_phases
            .filter((phase) => phase.kind === "VEHICLE")
            .map((phase) => [phase.signal_key, phase.color] as const),
        );
        for (const [key, color] of current) {
          const before = previous.get(key);
          if (before !== undefined && before !== color) {
            changes += 1;
            expect(LEGAL.has(`${before}>${color}`), `${tick.tick} ${key} ${before}>${color}`).toBe(
              true,
            );
          }
        }
        previous = current;
      }
      expect(changes).toBeGreaterThan(0);
    },
  );
});

describe("mock light under the animated vehicle", () => {
  it.each([1, 5, 10])(
    "keeps the route light green in the tick the map animates the vehicle across (x%s)",
    (playback) => {
      const session = createMockSession(modeRequest("ENABLED", { playback_speed: playback }));
      const { ticks } = runToCompletion(session);
      let previous = 0;
      for (const tick of ticks) {
        const elapsed = tick.kpi_metrics.total_time_elapsed_sec;
        session.timeline.reachSeconds.forEach((reach, index) => {
          if (reach > previous && reach <= elapsed) {
            const id = session.route.route_intersections[index].id;
            const light = tick.signal_phases.find(
              (phase) => phase.signal_key === `${id}-S1` && phase.kind === "VEHICLE",
            );
            expect(light?.color, `${id} tick ${tick.tick}`).toBe("GREEN");
          }
        });
        previous = elapsed;
      }
    },
  );
});

describe("mock playback speed", () => {
  it("streams the same tick for every simulated second at every playback speed", () => {
    const run = (playback: 1 | 5 | 10) =>
      runToCompletion(
        createMockSession(modeRequest("DISABLED", { playback_speed: playback })),
      ).ticks.map((tick) => ({ ...tick, timestamp: "" })); // wall-clock time only
    const baseline = run(1);

    expect(baseline.map((tick) => tick.tick)).toEqual(baseline.map((_, index) => index + 1));
    expect(run(5)).toEqual(baseline);
    expect(run(10)).toEqual(baseline);
  });
});

it("rejects a direct zero-distance start with NO_ROUTE", () => {
  const request = requestWithCascade(true);
  expect(() => createMockSession({ ...request, destination: request.origin })).toThrow(
    expect.objectContaining({ code: "NO_ROUTE" }),
  );
});

describe("route-specific geometry and motion", () => {
  it.each([100, 5400, 10000])("uses one coherent synthetic trip for %s m", (distance) => {
    const request = modeRequest("ENABLED", {
      destination: { lat: (distance / 6_371_000) * (180 / Math.PI), lng: 0 },
      traffic_density_multiplier: 1.5,
    });
    const session = createMockSession(request);
    const route = session.route;
    expect(route.route_geometry.coordinates).toEqual([
      [request.origin.lng, request.origin.lat],
      [request.destination.lng, request.destination.lat],
    ]);
    expect(route.total_distance_m).toBeCloseTo(distance, 7);
    expect(route.estimated_normal_time_sec).toBe(Math.round((distance * 780) / 5400));
    expect(route.estimated_greenwave_time_sec).toBe(Math.round((distance * 380) / 5400));
    expect(route.intersections_on_route).toEqual(["INT-9001", "INT-9002"]);
    expect(route.route_intersections.map((item) => item.name)).toEqual([
      "Mock junction A",
      "Mock junction B",
    ]);
    for (const [index, fraction] of [1480 / 5400, 1632 / 5400].entries()) {
      const junction = route.route_intersections[index];
      expect(junction.distance_along_route_m).toBeCloseTo(distance * fraction, 7);
      expect(junction.position.lat).toBeCloseTo(request.destination.lat * fraction, 10);
      expect(junction.position.lng).toBe(0);
    }
    expect(route.route_intersections.map((item) => item.cascade_targets)).toEqual(
      distance === 10000 ? [[], []] : [["INT-9002"], []],
    );
    const enabled = runToCompletion(session);
    const disabled = runToCompletion(
      createMockSession({ ...request, green_wave_mode: "DISABLED" }),
    );
    // Identical until the Green Wave run starts slowing for the first junction.
    const greenwave = (distance * 380) / 5400;
    const openRoadSeconds = greenwave - 2 * Math.min(3, greenwave / 4);
    const slowdownStart = Math.max(0, distance * (1480 / 5400) - 60) / (distance / openRoadSeconds);
    for (let index = 0; index + 1 < slowdownStart; index += 1) {
      expect(disabled.ticks[index].ambulance).toMatchObject({
        position: enabled.ticks[index].ambulance.position,
        speed_kmh: enabled.ticks[index].ambulance.speed_kmh,
      });
    }
    for (const run of [enabled, disabled]) {
      let previous = request.origin;
      for (const tick of run.ticks) {
        const moved = haversineMeters(previous, tick.ambulance.position);
        expect(Math.abs(tick.ambulance.speed_kmh - moved * 3.6)).toBeLessThanOrEqual(0.051);
        expect(JSON.stringify(tick)).not.toMatch(/NaN|Infinity/);
        previous = tick.ambulance.position;
      }
      expect(run.ticks.at(-1)?.ambulance.position.lat).toBeCloseTo(request.destination.lat, 10);
    }
    expect(disabled.dispatches).toEqual([]);
  });
});

it("keeps a short trip's arrival KPI while its signals recover", () => {
  const session = createMockSession(
    modeRequest("ENABLED", {
      destination: { lat: (100 / 6_371_000) * (180 / Math.PI), lng: 0 },
    }),
  );
  const { ticks } = runToCompletion(session);
  const arrived = ticks.filter((tick) => tick.ambulance.status === "ARRIVED");
  expect(arrived.length).toBeGreaterThan(1);
  expect(arrived.every((tick) => tick.kpi_metrics.total_time_elapsed_sec === 7)).toBe(true);
  expect(ticks.at(-1)?.intersections.every((item) => item.state === "NORMAL")).toBe(true);
});
