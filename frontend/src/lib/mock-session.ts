import {
  estimateMockNormalTravelTimeSeconds,
  MOCK_CLEARING_TTI_SECONDS,
  MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
  MOCK_HOLD_BUFFER_SECONDS,
  MOCK_MIN_HOLD_SECONDS,
  MOCK_PRIORITY_GREEN_TTI_SECONDS,
  MOCK_RECOVERY_SECONDS,
  MOCK_ROUTE_DISTANCE_METERS,
  MOCK_SAMPLE_INTERSECTIONS,
  MOCK_SIGNAL_ALL_RED_SECONDS,
  MOCK_SIGNAL_GREEN_SECONDS,
  MOCK_SIGNAL_YELLOW_SECONDS,
  MOCK_STANDARD_CLEARANCE_SECONDS,
} from "@/lib/mock-simulation-config";
import { positionOnRoute } from "@/lib/route-position";
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
};

type MockSignalHead = { color: SignalPhaseColor; sinceSeconds: number };

export function createMockSession(request: SimulationStartRequest): MockSession {
  const route = createMockRoute(request);
  return {
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

function createMockRoute(request: SimulationStartRequest): SimulationStartResponse {
  const routeGeometry: SimulationStartResponse["route_geometry"] = {
    type: "LineString",
    coordinates: [
      [request.origin.lng, request.origin.lat],
      [request.destination.lng, request.destination.lat],
    ],
  };
  const routeIntersections = MOCK_SAMPLE_INTERSECTIONS.map((intersection, sourceIndex) => {
    // Synthetic position: the sample distance projected onto the straight mock line.
    const coordinates = positionOnRoute(
      routeGeometry,
      intersection.distance_along_route_m / MOCK_ROUTE_DISTANCE_METERS,
    );
    if (!coordinates) throw new Error("Mock route requires two coordinates");
    const cascadeTargets = request.enable_cascade_mode
      ? MOCK_SAMPLE_INTERSECTIONS.slice(sourceIndex + 1)
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
    total_distance_m: MOCK_ROUTE_DISTANCE_METERS,
    estimated_normal_time_sec: estimateMockNormalTravelTimeSeconds(
      request.traffic_density_multiplier,
    ),
    estimated_greenwave_time_sec: MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
    intersections_on_route: routeIntersections.map((intersection) => intersection.id),
    route_intersections: routeIntersections,
    origin_snapped: { position: request.origin, snap_distance_m: 0 },
    destination_snapped: { position: request.destination, snap_distance_m: 0 },
    green_wave_mode: request.green_wave_mode,
  };
}

/** Wait at each intersection: none with ER Green Wave, a standard-traffic clearance without. */
function clearanceSeconds(request: SimulationStartRequest): number {
  return request.green_wave_mode === "DISABLED"
    ? MOCK_STANDARD_CLEARANCE_SECONDS * request.traffic_density_multiplier
    : 0;
}

/** When the vehicle reaches intersection `index`: open-road time plus earlier clearances. */
function arrivalSeconds(session: MockSession, index: number): number {
  const { route } = session;
  return (
    (route.route_intersections[index].distance_along_route_m / route.total_distance_m) *
      route.estimated_greenwave_time_sec +
    index * clearanceSeconds(session.request)
  );
}

/** Index of the intersection the vehicle is waiting at, or -1 while it moves. */
function waitingIndex(session: MockSession): number {
  const clearance = clearanceSeconds(session.request);
  return session.signals.findIndex((_, index) => {
    const reached = arrivalSeconds(session, index);
    return session.elapsedSeconds >= reached && session.elapsedSeconds < reached + clearance;
  });
}

/** Open-road share of the route driven so far; the same timeline in both modes between waits. */
function routeProgress(session: MockSession): number {
  const clearance = clearanceSeconds(session.request);
  let waited = 0;
  session.signals.forEach((_, index) => {
    const reached = arrivalSeconds(session, index);
    if (session.elapsedSeconds > reached) {
      waited += Math.min(clearance, session.elapsedSeconds - reached);
    }
  });
  return Math.min(
    1,
    (session.elapsedSeconds - waited) / session.route.estimated_greenwave_time_sec,
  );
}

function tripSeconds(session: MockSession): number {
  return (
    session.route.estimated_greenwave_time_sec +
    session.signals.length * clearanceSeconds(session.request)
  );
}

/** Advances one wall-clock tick as `playback_speed` one-second sub-steps. */
export function advanceMockSession(session: MockSession): {
  tick: SimulationTickEvent;
  dispatch: ItsDispatchEvent | null;
  completed: boolean;
} {
  const enteredClearing = new Set<number>();
  session.tick += 1;
  for (let step = 0; step < session.request.playback_speed; step += 1) {
    session.elapsedSeconds += 1;
    stepMockSignals(session, enteredClearing);
  }

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
  const waiting = !arrived && waitingIndex(session) !== -1;

  return {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "SIMULATION_TICK",
    simulation_id: request.simulation_id,
    tick: session.tick,
    timestamp,
    ambulance: {
      id: "AMB-KRA-01",
      position: toPosition(coordinates),
      speed_kmh:
        arrived || waiting ? 0 : Number((62.4 + Math.sin(session.tick / 5) * 3).toFixed(1)),
      status: arrived
        ? "ARRIVED"
        : waiting
          ? "CROSSING_INTERSECTION"
          : nextSignal?.is_active_corridor
            ? "APPROACHING_INTERSECTION"
            : "EN_ROUTE",
    },
    kpi_metrics: {
      current_time_saved_sec: Math.round(
        Math.max(0, route.estimated_normal_time_sec - tripSeconds(session)) * progress,
      ),
      total_time_elapsed_sec: elapsed,
    },
    intersections,
    signal_phases: mockSignalPhases(session),
  };
}

/** (vehicle, pedestrian) colours of `group` in the two-group cycle, as the backend projects them. */
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
    // Standard traffic: no corridor states and no dispatch; an intersection is passed after its wait.
    const clearance = clearanceSeconds(request);
    signals.forEach((signal, index) => {
      if (elapsedSeconds >= arrivalSeconds(session, index) + clearance) signal.passed = true;
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
    if (tti <= 0) {
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
