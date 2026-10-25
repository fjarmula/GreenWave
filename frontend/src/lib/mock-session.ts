import { MockItsController, routeMovementColor, type MockSignal } from "./mock-its-controller";
import {
  MOCK_CLEARING_TTI_SECONDS,
  MOCK_GREENWAVE_APPROACH_DISTANCE_M,
  MOCK_HOLD_BUFFER_SECONDS,
  MOCK_MIN_INTERSECTION_DELAY_SECONDS,
  MOCK_MIN_ROLLING_SPEED_MPS,
  MOCK_MIN_HOLD_SECONDS,
  MOCK_ORDINARY_SPEED_LIMIT_MPS,
  MOCK_SAMPLE_INTERSECTIONS,
  MOCK_STANDARD_CLEARANCE_SECONDS,
  MOCK_STANDARD_CROSSING_DISTANCE_M,
  MOCK_STANDARD_MAX_RED_LOSS_SECONDS,
  MOCK_STANDARD_MIN_ROLLING_SPEED_MPS,
} from "@/lib/mock-simulation-config";
import { estimateMockRoute, type MockRouteMetrics } from "@/lib/mock-route-metrics";
import { SimulationAdapterError } from "@/lib/transport/errors";
import { positionOnRoute } from "@/lib/route-position";
import { simulatedVehicleId } from "@/lib/vehicle-ids";
import type {
  IntersectionTelemetry,
  ItsDispatchEvent,
  Position,
  SignalPhaseColor,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

const MOCK_CASCADE_DISTANCE_METERS = 250;
// Two synthetic signals per sample intersection, placed beside its synthetic position: S1 controls
// the route's approach, S2 the crossing street. Positions are visibly mock, not real signal nodes.
export type MockSession = {
  controller: MockItsController;
  driveSeconds: number;
  request: SimulationStartRequest;
  route: SimulationStartResponse;
  tick: number;
  elapsedSeconds: number;
  signals: MockSignal[];
  dispatchCount: number;
  /** Shown vehicle light per synthetic signal key, so lights change only legally between ticks. */
  signalHeads: Map<string, MockSignalHead>;
  timeline: MockTimeline;
  /** Elapsed seconds when the current tick began; the map animates the vehicle across the tick. */
  intervalStartSeconds: number;
};

/** One stretch driven at constant speed; `crossing` marks a controlled crossing or D_min slowdown. */
type MockLeg = {
  startSeconds: number;
  startMeters: number;
  endSeconds: number;
  speedMps: number;
  crossing: boolean;
};

type MockTimeline = { legs: MockLeg[]; reachSeconds: number[]; tripSeconds: number };

type MockSignalHead = { color: SignalPhaseColor; sinceSeconds: number };

export function createMockSession(request: SimulationStartRequest): MockSession {
  const metrics = estimateMockRoute(
    request.origin,
    request.destination,
    request.traffic_density_multiplier,
  );
  if (metrics.distanceMeters === 0) {
    throw new SimulationAdapterError({
      kind: "http",
      code: "NO_ROUTE",
      message: "Mock route requires distinct origin and destination positions",
    });
  }
  request = {
    ...request,
    its_scenario:
      request.green_wave_mode === "DISABLED" ? "NOMINAL" : (request.its_scenario ?? "NOMINAL"),
  };
  const route = createMockRoute(request, metrics);
  const controller = new MockItsController(route, request.its_scenario);
  return {
    timeline: mockTimeline(route, request, metrics.greenwaveSeconds),
    intervalStartSeconds: 0,
    request,
    route,
    tick: 0,
    elapsedSeconds: 0,
    signals: controller.signals,
    controller,
    driveSeconds: 0,
    dispatchCount: 0,
    signalHeads: new Map(),
  };
}

function toPosition(coordinates: [number, number]): Position {
  return { lat: coordinates[1], lng: coordinates[0] };
}

function createMockRoute(
  request: SimulationStartRequest,
  metrics: MockRouteMetrics,
): SimulationStartResponse {
  const scaledIntersections = MOCK_SAMPLE_INTERSECTIONS.map(
    ({ routeFraction, ...intersection }) => ({
      ...intersection,
      distance_along_route_m: routeFraction * metrics.distanceMeters,
    }),
  );
  const routeGeometry: SimulationStartResponse["route_geometry"] = {
    type: "LineString",
    coordinates: [
      [request.origin.lng, request.origin.lat],
      [request.destination.lng, request.destination.lat],
    ],
  };
  const routeIntersections = scaledIntersections.map((intersection, sourceIndex) => {
    // Synthetic position: the sample distance projected onto the straight mock line.
    const coordinates = positionOnRoute(
      routeGeometry,
      intersection.distance_along_route_m / metrics.distanceMeters,
    );
    if (!coordinates) throw new Error("Mock route requires two coordinates");
    // Disabled runs never cascade, whatever the legacy cascade toggle says.
    const cascadeTargets =
      request.enable_cascade_mode && request.green_wave_mode !== "DISABLED"
        ? scaledIntersections
            .slice(sourceIndex + 1)
            .filter(
              (target) =>
                target.distance_along_route_m - intersection.distance_along_route_m <=
                MOCK_CASCADE_DISTANCE_METERS,
            )
            .map((target) => target.id)
        : [];
    return {
      ...intersection,
      position: toPosition(coordinates),
      cascade_targets: cascadeTargets,
    };
  });

  return {
    schema_version: "1.0",
    is_simulated: true,
    simulation_id: request.simulation_id,
    status: "INITIALIZED",
    route_geometry: routeGeometry,
    total_distance_m: metrics.distanceMeters,
    estimated_normal_time_sec: Math.round(metrics.normalSeconds),
    estimated_greenwave_time_sec: Math.round(metrics.greenwaveSeconds),
    intersections_on_route: routeIntersections.map((intersection) => intersection.id),
    route_intersections: routeIntersections,
    origin_snapped: { position: request.origin, snap_distance_m: 0 },
    destination_snapped: { position: request.destination, snap_distance_m: 0 },
    green_wave_mode: request.green_wave_mode,
    its_scenario: request.its_scenario,
  };
}

/** Rolling cautious speed: the ordinary limit plus the remaining extra time per metre. */
function cautiousSpeedMps(limitMps: number, remainingMeters: number, extraSeconds: number): number {
  return 1 / (1 / limitMps + extraSeconds / remainingMeters);
}

/**
 * `[length, extra]` of a standard red crossing, the backend's `standard_crossing` with the fixed
 * delay as the wait: the loss is capped and the crossing extends so it never drops below the floor.
 */
function standardCrossing(limitMps: number, density: number): [number, number] {
  const floor = MOCK_STANDARD_MIN_ROLLING_SPEED_MPS;
  if (limitMps <= floor) return [MOCK_STANDARD_CROSSING_DISTANCE_M, 0];
  const extra = Math.min(
    MOCK_STANDARD_CLEARANCE_SECONDS * density,
    MOCK_STANDARD_MAX_RED_LOSS_SECONDS,
  );
  return [Math.max(MOCK_STANDARD_CROSSING_DISTANCE_M, extra / (1 / floor - 1 / limitMps)), extra];
}

/**
 * The whole drive, precomputed: open road at the ambulance speed and, with ER Green Wave disabled,
 * a controlled crossing wherever the route movement is red or yellow on reaching a stop line. The
 * backend's rolling formula at contract level; a later stop line replaces an active crossing.
 * Enabled spends each junction's D_min as the backend does: a rolling slowdown over the approach
 * (never before the previous junction), extended past the line to respect the floor, so the trip
 * still takes `greenwaveSeconds` and the vehicle never stops.
 */
function mockTimeline(
  route: SimulationStartResponse,
  request: SimulationStartRequest,
  greenwaveSeconds: number,
): MockTimeline {
  const total = route.total_distance_m;
  const stops = route.route_intersections.map((item) => item.distance_along_route_m);
  const enabled = request.green_wave_mode !== "DISABLED";
  // The synthetic estimate includes D_min per junction; the open road is driven without it. A
  // tiny synthetic route caps it so the open road keeps at least half the estimate.
  const delay = stops.length
    ? Math.min(MOCK_MIN_INTERSECTION_DELAY_SECONDS, greenwaveSeconds / (2 * stops.length))
    : 0;
  // Keep subsecond precision internally; the public estimate contract uses whole seconds.
  const ambulanceMps = total / (greenwaveSeconds - stops.length * delay);
  const legs: MockLeg[] = [];
  const reachSeconds: number[] = [];
  let [seconds, meters, crossing, cautious, slowed] = [0, 0, 0, 0, 0];
  while (meters < total) {
    const next = stops[reachSeconds.length];
    let windowStart = Infinity;
    if (enabled && next !== undefined && slowed === reachSeconds.length) {
      windowStart = Math.max(stops[slowed - 1] ?? 0, next - MOCK_GREENWAVE_APPROACH_DISTANCE_M);
      if (meters >= windowStart) {
        windowStart = Infinity;
        slowed += 1;
        const needed =
          ambulanceMps > MOCK_MIN_ROLLING_SPEED_MPS
            ? delay / (1 / MOCK_MIN_ROLLING_SPEED_MPS - 1 / ambulanceMps)
            : 0;
        crossing += Math.max(next - meters, needed);
        cautious += delay;
      }
    }
    const speedMps =
      crossing > 0
        ? cautiousSpeedMps(
            enabled ? ambulanceMps : Math.min(ambulanceMps, MOCK_ORDINARY_SPEED_LIMIT_MPS),
            crossing,
            cautious,
          )
        : ambulanceMps;
    const end = Math.min(
      total,
      next ?? Infinity,
      windowStart,
      crossing > 0 ? meters + crossing : Infinity,
    );
    const endSeconds = seconds + (end - meters) / speedMps;
    legs.push({
      startSeconds: seconds,
      startMeters: meters,
      endSeconds,
      speedMps,
      crossing: crossing > 0,
    });
    if (crossing > 0) {
      cautious -= (cautious * (end - meters)) / crossing;
      crossing -= end - meters;
      if (crossing <= 1e-9) [crossing, cautious] = [0, 0];
    }
    [seconds, meters] = [endSeconds, end];
    if (meters === next) {
      reachSeconds.push(seconds);
      if (!enabled) {
        const red = routeMovementColor(seconds) !== "GREEN";
        [crossing, cautious] = red
          ? standardCrossing(
              Math.min(ambulanceMps, MOCK_ORDINARY_SPEED_LIMIT_MPS),
              request.traffic_density_multiplier,
            )
          : [0, 0];
      }
    }
  }
  return { legs, reachSeconds, tripSeconds: seconds };
}

/** When the vehicle reaches intersection `index`. */
function arrivalSeconds(session: MockSession, index: number): number {
  return session.timeline.reachSeconds[index];
}

/** The leg being driven at `seconds`, or undefined once arrived. */
function legAt(session: MockSession, seconds: number): MockLeg | undefined {
  return session.timeline.legs.find(
    (leg) => seconds >= leg.startSeconds && seconds < leg.endSeconds,
  );
}

function metersAt(session: MockSession, seconds: number): number {
  const leg = legAt(session, Math.max(0, seconds));
  if (!leg) return session.route.total_distance_m;
  return leg.startMeters + (Math.max(0, seconds) - leg.startSeconds) * leg.speedMps;
}

/** Share of the route driven so far. */
function routeProgress(session: MockSession): number {
  return Math.min(1, metersAt(session, session.driveSeconds) / session.route.total_distance_m);
}

/** Advances one tick: exactly one simulated second, whatever the playback speed. */
export function advanceMockSession(session: MockSession): {
  tick: SimulationTickEvent;
  dispatch: ItsDispatchEvent | null;
  completed: boolean;
  feedbacks: import("@/types/telemetry").ItsFeedbackEvent[];
  failure: import("@/types/telemetry").CancelReason | null;
} {
  const enteredClearing = new Set<number>();
  session.tick += 1;
  session.intervalStartSeconds = session.driveSeconds;
  session.elapsedSeconds += 1;
  let nextDrive = session.driveSeconds + 1;
  if (session.request.green_wave_mode !== "DISABLED") {
    const blocked = session.route.route_intersections.find(
      (i, n) =>
        arrivalSeconds(session, n) >= session.driveSeconds &&
        arrivalSeconds(session, n) <= nextDrive &&
        !session.controller.phases.some(
          (p) =>
            p.intersection_id === i.id &&
            p.kind === "VEHICLE" &&
            p.signal_key.endsWith("S1") &&
            p.color === "GREEN",
        ),
    );
    if (blocked)
      nextDrive = arrivalSeconds(session, session.route.intersections_on_route.indexOf(blocked.id));
  }
  session.driveSeconds = nextDrive;
  const timestamp = new Date().toISOString();
  const ttis = session.signals.map((_, i) =>
    Math.max(0, arrivalSeconds(session, i) - session.driveSeconds),
  );
  const passed = session.signals.map(
    (_, i) => arrivalSeconds(session, i) < session.intervalStartSeconds,
  );
  const feedbacks = session.controller.advance(session.elapsedSeconds, ttis, passed, timestamp);
  stepMockSignals(session, enteredClearing);
  const dispatch = session.controller.failure
    ? null
    : buildMockDispatch(session, enteredClearing, timestamp, Date.now());
  if (dispatch) session.controller.submit(dispatch, session.elapsedSeconds);
  const tick = buildMockTick(session, timestamp);
  const completed =
    routeProgress(session) === 1 && session.signals.every((s) => s.state === "NORMAL");
  return { tick, dispatch, completed, feedbacks, failure: session.controller.failure };
}

export function buildMockTick(session: MockSession, timestamp: string): SimulationTickEvent {
  const { route, request } = session;
  const elapsed = session.elapsedSeconds;
  const progress = routeProgress(session);
  const coordinates = positionOnRoute(route.route_geometry, progress);
  if (!coordinates) throw new Error("Mock simulation requires at least two route coordinates");

  const intersections: IntersectionTelemetry[] = route.route_intersections.map(
    (intersection, index) => {
      const signal = session.signals[index];
      return {
        id: intersection.id,
        name: intersection.name,
        state: signal.state,
        is_cascade: signal.isCascade,
        tti_seconds: signal.passed
          ? null
          : Math.max(0, Math.round(arrivalSeconds(session, index) - session.driveSeconds)),
        is_active_corridor: signal.state === "CLEARING" || signal.state === "PRIORITY_GREEN",
      };
    },
  );
  const nextSignal = intersections.find((intersection) => intersection.tti_seconds !== null);
  const arrived = progress === 1;
  const crossing = !arrived && legAt(session, session.driveSeconds)?.crossing === true;

  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_TICK",
    simulation_id: request.simulation_id,
    tick: session.tick,
    timestamp,
    ambulance: {
      id: simulatedVehicleId(request.vehicle_type),
      position: toPosition(coordinates),
      // Distance driven in this simulated second, including a partial arrival interval.
      speed_kmh: Number(
        (
          (metersAt(session, session.driveSeconds) -
            metersAt(session, session.intervalStartSeconds)) *
          3.6
        ).toFixed(1),
      ),
      status: arrived
        ? "ARRIVED"
        : crossing
          ? "CROSSING_INTERSECTION"
          : nextSignal?.is_active_corridor
            ? "APPROACHING_INTERSECTION"
            : "EN_ROUTE",
    },
    kpi_metrics: {
      current_time_saved_sec: Math.round(
        Math.max(0, route.estimated_normal_time_sec - session.timeline.tripSeconds) * progress,
      ),
      // Signal recovery keeps ticking after arrival but does not add travel time.
      total_time_elapsed_sec: Math.round(Math.min(elapsed, session.timeline.tripSeconds)),
    },
    intersections,
    signal_phases: session.controller.phases,
    its_requests: session.controller.requests.map((r) => ({ ...r })),
    its_observed_at_simulated_sec: session.elapsedSeconds,
  };
}

/** Returns null when no signal entered CLEARING this tick; counts only emitted dispatches. */
export function buildMockDispatch(
  session: MockSession,
  enteredClearing: Set<number>,
  timestamp: string,
  nowMs: number,
): ItsDispatchEvent | null {
  if (enteredClearing.size === 0) return null;
  const { route, request } = session;
  const group = [...enteredClearing].sort((a, b) => a - b);
  const ttis = group.map((index) =>
    Math.max(0, arrivalSeconds(session, index) - session.driveSeconds),
  );
  session.dispatchCount += 1;
  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "ITS_DISPATCH",
    message_id: `MSG-ITS-${session.dispatchCount}`,
    simulation_id: request.simulation_id,
    tick: session.tick,
    timestamp,
    system_source: "ER_GREENWAVE_ENGINE",
    target_system: "STeR_KRAKOW_ITS",
    payload: {
      priority_level: 1,
      vehicle_type: request.vehicle_type,
      intersections_group: group.map((index) => route.route_intersections[index].id),
      action: "FORCE_GREEN_PHASE",
      hold_duration_sec: Math.max(
        MOCK_MIN_HOLD_SECONDS,
        Math.ceil(Math.max(...ttis)) + MOCK_HOLD_BUFFER_SECONDS,
      ),
      expected_arrival_utc: new Date(nowMs + Math.min(...ttis) * 1000).toISOString(),
    },
  };
}

/** Request selection only; reported traffic belongs to the synthetic controller. */
export function stepMockSignals(session: MockSession, selected: Set<number>): void {
  if (session.request.green_wave_mode === "DISABLED") return;
  const used = new Set(session.controller.requests.flatMap((r) => r.intersections_group));
  const own = session.signals.flatMap((signal, i) =>
    !signal.passed &&
    !used.has(session.route.intersections_on_route[i]) &&
    arrivalSeconds(session, i) - session.driveSeconds <= MOCK_CLEARING_TTI_SECONDS
      ? [i]
      : [],
  );
  own.forEach((i) => selected.add(i));
  if (session.request.enable_cascade_mode)
    own.forEach((i) =>
      session.route.route_intersections[i].cascade_targets.forEach((id) => {
        const n = session.route.intersections_on_route.indexOf(id);
        if (n >= 0 && !used.has(id) && !session.signals[n].passed) {
          selected.add(n);
          session.signals[n].isCascade = !own.includes(n);
        }
      }),
    );
}
