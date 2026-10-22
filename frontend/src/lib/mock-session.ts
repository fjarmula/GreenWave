import {
  MOCK_CLEARING_TTI_SECONDS,
  MOCK_HOLD_BUFFER_SECONDS,
  MOCK_MIN_HOLD_SECONDS,
  MOCK_PRIORITY_GREEN_TTI_SECONDS,
  MOCK_RECOVERY_SECONDS,
  MOCK_ORDINARY_SPEED_LIMIT_MPS,
  MOCK_SAMPLE_INTERSECTIONS,
  MOCK_SIGNAL_ALL_RED_SECONDS,
  MOCK_SIGNAL_GREEN_SECONDS,
  MOCK_SIGNAL_YELLOW_SECONDS,
  MOCK_STANDARD_CLEARANCE_SECONDS,
  MOCK_STANDARD_CROSSING_DISTANCE_M,
} from "@/lib/mock-simulation-config";
import { estimateMockRoute, type MockRouteMetrics } from "@/lib/mock-route-metrics";
import { SimulationAdapterError } from "@/lib/transport/errors";
import { positionOnRoute } from "@/lib/route-position";
import { simulatedVehicleId } from "@/lib/vehicle-ids";
import type {
  IntersectionState,
  IntersectionTelemetry,
  ItsDispatchEvent,
  Position,
  RouteIntersection,
  SignalMovementKind,
  SignalPhaseColor,
  SignalPhaseIndicator,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

const MOCK_CASCADE_DISTANCE_METERS = 250;
// Two synthetic signals per sample intersection, placed beside its synthetic position: S1 controls
// the route's approach, S2 the crossing street. Positions are visibly mock, not real signal nodes.
const MOCK_SIGNALS = [
  { suffix: "S1", latOffset: -0.0003, lngOffset: 0 },
  { suffix: "S2", latOffset: 0.0001, lngOffset: 0.0006 },
] as const;

type MockSignal = {
  state: IntersectionState;
  isCascade: boolean;
  recoveryStartedAtSeconds: number | null;
  passed: boolean;
};

export type MockSession = {
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

/** One stretch driven at constant speed; `crossing` marks a disabled controlled crossing. */
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
  const route = createMockRoute(request, metrics);
  return {
    timeline: mockTimeline(route, request, metrics.greenwaveSeconds),
    intervalStartSeconds: 0,
    request,
    route,
    tick: 0,
    elapsedSeconds: 0,
    signals: route.route_intersections.map(() => ({
      state: "NORMAL",
      isCascade: false,
      recoveryStartedAtSeconds: null,
      passed: false,
    })),
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
  };
}

/** Rolling cautious speed: the ordinary limit plus the remaining extra time per metre. */
function cautiousSpeedMps(limitMps: number, remainingMeters: number, extraSeconds: number): number {
  return 1 / (1 / limitMps + extraSeconds / remainingMeters);
}

/**
 * The whole drive, precomputed: open road at the ambulance speed and, with ER Green Wave disabled,
 * a controlled crossing wherever the route movement is red or yellow on reaching a stop line. The
 * backend's rolling formula at contract level; a later stop line replaces an active crossing.
 */
function mockTimeline(
  route: SimulationStartResponse,
  request: SimulationStartRequest,
  greenwaveSeconds: number,
): MockTimeline {
  const total = route.total_distance_m;
  // Keep subsecond precision internally; the public estimate contract uses whole seconds.
  const ambulanceMps = total / greenwaveSeconds;
  const stops = route.route_intersections.map((item) => item.distance_along_route_m);
  const legs: MockLeg[] = [];
  const reachSeconds: number[] = [];
  let [seconds, meters, crossing, cautious] = [0, 0, 0, 0];
  while (meters < total) {
    const next = stops[reachSeconds.length];
    const speedMps =
      crossing > 0
        ? cautiousSpeedMps(
            Math.min(ambulanceMps, MOCK_ORDINARY_SPEED_LIMIT_MPS),
            crossing,
            cautious,
          )
        : ambulanceMps;
    const end = Math.min(total, next ?? Infinity, crossing > 0 ? meters + crossing : Infinity);
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
      const red = request.green_wave_mode === "DISABLED" && routeMovementColor(seconds) !== "GREEN";
      crossing = red ? MOCK_STANDARD_CROSSING_DISTANCE_M : 0;
      cautious = red ? MOCK_STANDARD_CLEARANCE_SECONDS * request.traffic_density_multiplier : 0;
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
  return Math.min(1, metersAt(session, session.elapsedSeconds) / session.route.total_distance_m);
}

/** Advances one tick: exactly one simulated second, whatever the playback speed. */
export function advanceMockSession(session: MockSession): {
  tick: SimulationTickEvent;
  dispatch: ItsDispatchEvent | null;
  completed: boolean;
} {
  const enteredClearing = new Set<number>();
  session.tick += 1;
  session.intervalStartSeconds = session.elapsedSeconds;
  session.elapsedSeconds += 1;
  stepMockSignals(session, enteredClearing);

  const timestamp = new Date().toISOString();
  const tick = buildMockTick(session, timestamp);
  const dispatch = buildMockDispatch(session, enteredClearing, timestamp, Date.now());
  const arrived = routeProgress(session) === 1;
  const completed = arrived && session.signals.every((signal) => signal.state === "NORMAL");
  return { tick, dispatch, completed };
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
          : Math.max(0, Math.round(arrivalSeconds(session, index) - elapsed)),
        is_active_corridor: signal.state === "CLEARING" || signal.state === "PRIORITY_GREEN",
      };
    },
  );
  const nextSignal = intersections.find((intersection) => intersection.tti_seconds !== null);
  const arrived = progress === 1;
  const crossing = !arrived && legAt(session, elapsed)?.crossing === true;

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
        ((metersAt(session, elapsed) - metersAt(session, elapsed - 1)) * 3.6).toFixed(1),
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
    signal_phases: mockSignalPhases(session),
  };
}

/**
 * (vehicle, pedestrian) colours of `group` in the two-group cycle: a documented duplicate of the
 * backend programme (the frontend cannot import it). Synthetic S1 (the route approach) is group 0,
 * S2 (the crossing street) group 1.
 */
function cycleColors(group: number, nowSeconds: number): [SignalPhaseColor, SignalPhaseColor] {
  const slot = MOCK_SIGNAL_GREEN_SECONDS + MOCK_SIGNAL_YELLOW_SECONDS + MOCK_SIGNAL_ALL_RED_SECONDS;
  const phase = nowSeconds % (slot * MOCK_SIGNALS.length);
  const active = Math.floor(phase / slot);
  const within = phase - active * slot;
  if (group !== active) return ["RED", within < MOCK_SIGNAL_GREEN_SECONDS ? "GREEN" : "RED"];
  const vehicle =
    within < MOCK_SIGNAL_GREEN_SECONDS
      ? "GREEN"
      : within < MOCK_SIGNAL_GREEN_SECONDS + MOCK_SIGNAL_YELLOW_SECONDS
        ? "YELLOW"
        : "RED";
  return [vehicle, "RED"];
}

/** The programme colour of the route vehicle movement (S1) at `seconds`, used by motion. */
function routeMovementColor(seconds: number): SignalPhaseColor {
  return cycleColors(0, seconds)[0];
}

/** The next shown vehicle light, as the backend limits it: GREEN → YELLOW → RED → GREEN only. */
function nextHead(
  prior: MockSignalHead | undefined,
  target: SignalPhaseColor,
  now: number,
  mayTurnGreen: boolean,
): MockSignalHead {
  if (!prior) return { color: target, sinceSeconds: now };
  if (prior.color === "GREEN") {
    return target === "GREEN" ? prior : { color: "YELLOW", sinceSeconds: now };
  }
  if (prior.color === "YELLOW") {
    return now - prior.sinceSeconds >= MOCK_SIGNAL_YELLOW_SECONDS
      ? { color: "RED", sinceSeconds: now }
      : prior;
  }
  return target === "GREEN" && mayTurnGreen ? { color: "GREEN", sinceSeconds: now } : prior;
}

/** Mirrors the backend projection, then records the shown lights on the session. */
function mockSignalPhases(session: MockSession): SignalPhaseIndicator[] {
  const now = session.elapsedSeconds;
  return session.route.route_intersections.flatMap((intersection, index) => {
    const { state } = session.signals[index];
    const signals = MOCK_SIGNALS.map((signal, group) => {
      let [vehicle, pedestrian] = cycleColors(group, now);
      const onRoute = signal.suffix === "S1";
      if (state === "PRIORITY_GREEN") {
        [vehicle, pedestrian] = [onRoute ? "GREEN" : "RED", "RED"];
      } else if (state === "CLEARING") {
        [vehicle, pedestrian] = [onRoute ? vehicle : "RED", "RED"];
      }
      const key = `${intersection.id}-${signal.suffix}`;
      return { signal, key, vehicle, pedestrian, prior: session.signalHeads.get(key) };
    });
    return signals.flatMap(({ signal, key, vehicle, pedestrian, prior }) => {
      // Green only once every light not also turning green has stopped.
      const mayTurnGreen = signals.every(
        (other) =>
          other.key === key || other.vehicle === "GREEN" || (other.prior?.color ?? "RED") === "RED",
      );
      const head = nextHead(prior, vehicle, now, mayTurnGreen);
      session.signalHeads.set(key, head);
      const position = {
        lat: intersection.position.lat + signal.latOffset,
        lng: intersection.position.lng + signal.lngOffset,
      };
      return [
        mockPhase(intersection, key, "VEHICLE", head.color, position),
        mockPhase(
          intersection,
          key,
          "PEDESTRIAN",
          head.color === "RED" ? pedestrian : "RED",
          position,
        ),
      ];
    });
  });
}

function mockPhase(
  intersection: RouteIntersection,
  signalKey: string,
  kind: SignalMovementKind,
  color: SignalPhaseColor,
  position: Position,
): SignalPhaseIndicator {
  return {
    intersection_id: intersection.id,
    signal_key: signalKey,
    kind,
    color,
    position,
    accessible_label: `Simulated mock ${kind.toLowerCase()} signal ${signalKey} at ${intersection.id}: ${color.toLowerCase()}`,
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
    Math.max(0, arrivalSeconds(session, index) - session.elapsedSeconds),
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

export function stepMockSignals(session: MockSession, enteredClearing: Set<number>): void {
  const { route, request, signals, elapsedSeconds } = session;
  const ownEntries: number[] = [];

  if (request.green_wave_mode === "DISABLED") {
    // Standard traffic: no corridor states and no dispatch; an intersection is passed once reached.
    signals.forEach((signal, index) => {
      if (elapsedSeconds >= arrivalSeconds(session, index)) signal.passed = true;
    });
    return;
  }

  signals.forEach((signal, index) => {
    const tti = arrivalSeconds(session, index) - elapsedSeconds;
    if (signal.state === "RECOVERY") {
      if (elapsedSeconds - (signal.recoveryStartedAtSeconds ?? 0) >= MOCK_RECOVERY_SECONDS) {
        signal.state = "NORMAL";
        signal.isCascade = false;
      }
      return;
    }
    if (signal.passed) return;
    // Released only once reached before this tick: the map animates the vehicle across the tick
    // under its final lights, so priority must not end beneath it (as the backend does).
    if (tti <= 0 && arrivalSeconds(session, index) <= session.intervalStartSeconds) {
      signal.passed = true;
      signal.state = "RECOVERY";
      signal.recoveryStartedAtSeconds = elapsedSeconds;
      return;
    }
    if (signal.state === "NORMAL" && tti <= MOCK_CLEARING_TTI_SECONDS) {
      signal.state = "CLEARING";
      signal.isCascade = false;
      ownEntries.push(index);
      enteredClearing.add(index);
    }
    if (signal.state === "CLEARING" && tti <= MOCK_PRIORITY_GREEN_TTI_SECONDS) {
      signal.state = "PRIORITY_GREEN";
    }
  });

  if (!request.enable_cascade_mode) return;
  // One hop only, ahead along the route (D16).
  for (const triggerIndex of ownEntries) {
    const triggerDistance = route.route_intersections[triggerIndex].distance_along_route_m;
    signals.forEach((signal, index) => {
      const distance = route.route_intersections[index].distance_along_route_m - triggerDistance;
      if (
        index > triggerIndex &&
        !signal.passed &&
        signal.state === "NORMAL" &&
        distance <= MOCK_CASCADE_DISTANCE_METERS
      ) {
        signal.state = "CLEARING";
        signal.isCascade = true;
        enteredClearing.add(index);
      }
    });
  }
}
