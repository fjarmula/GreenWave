import {
  FAILED_STATUSES,
  MockItsController,
  routeMovementColor,
  type MockSignal,
} from "./mock-its-controller";
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
import {
  estimateMockRoute,
  mockRouteGeometry,
  type MockRouteMetrics,
} from "@/lib/mock-route-metrics";
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
  standardTimeline: MockTimeline;
  /** Elapsed seconds when the current tick began; the map animates the vehicle across the tick. */
  intervalStartSeconds: number;
  greenwaveSeconds: number;
  /** Junction indexes whose priority request failed; crossed by standard rules from then on. */
  fallback: Set<number>;
  /** Simulated minus timeline seconds when the timeline was last rebuilt (time held so far). */
  colorOffsetSeconds: number;
};

/**
 * One stretch driven at constant speed; `crossing` marks a controlled crossing or D_min slowdown.
 * The crossing state at its start lets a rebuilt timeline resume mid-leg.
 */
type MockLeg = {
  startSeconds: number;
  startMeters: number;
  endSeconds: number;
  speedMps: number;
  crossing: boolean;
  crossingMeters: number;
  cautiousSeconds: number;
  standardMeters: number;
  standardSeconds: number;
  standard: boolean;
  slowed: number;
  slowdownOwner: number | null;
};

type MockTimeline = { legs: MockLeg[]; reachSeconds: number[]; tripSeconds: number };

/** Where a rebuilt timeline resumes: the driven prefix and the crossing state at that moment. */
type MockCursor = Omit<
  MockLeg,
  "startSeconds" | "startMeters" | "endSeconds" | "speedMps" | "crossing"
> & {
  seconds: number;
  meters: number;
  legs: MockLeg[];
  reachSeconds: number[];
};

/** Which junctions fall back, and the ordinary-programme time of the timeline's clock. */
type MockTimelinePlan = {
  fallback: ReadonlySet<number>;
  colorOffsetSeconds: number;
  /** Junctions reached exactly at the cursor that just fell back: they decide at release. */
  decideAtStart?: readonly number[];
};

const PRIORITY_PLAN: MockTimelinePlan = { fallback: new Set(), colorOffsetSeconds: 0 };

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
  const controller = new MockItsController(route, request.its_scenario, request.its_outcome_seed);
  return {
    greenwaveSeconds: metrics.greenwaveSeconds,
    fallback: new Set(),
    colorOffsetSeconds: 0,
    timeline: mockTimeline(route, request, metrics.greenwaveSeconds),
    standardTimeline: mockTimeline(
      route,
      { ...request, green_wave_mode: "DISABLED" },
      metrics.greenwaveSeconds,
    ),
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
  const routeGeometry = mockRouteGeometry(request.origin, request.destination);
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

  const route: SimulationStartResponse = {
    schema_version: "1.0",
    is_simulated: true,
    simulation_id: request.simulation_id,
    status: "INITIALIZED",
    route_geometry: routeGeometry,
    total_distance_m: metrics.distanceMeters,
    estimated_normal_time_sec: Math.round(metrics.normalSeconds),
    estimated_greenwave_time_sec: Math.round(metrics.greenwaveSeconds),
    estimated_standard_time_sec: 0,
    intersections_on_route: routeIntersections.map((intersection) => intersection.id),
    route_intersections: routeIntersections,
    origin_snapped: { position: request.origin, snap_distance_m: 0 },
    destination_snapped: { position: request.destination, snap_distance_m: 0 },
    green_wave_mode: request.green_wave_mode,
    its_scenario: request.its_scenario,
    its_outcome_seed: request.its_outcome_seed ?? 0,
  };
  // The backend's dry run of disabled motion: the mock's exact disabled timeline.
  const standard = mockTimeline(
    route,
    { ...request, green_wave_mode: "DISABLED" },
    metrics.greenwaveSeconds,
  );
  route.estimated_standard_time_sec = Math.round(standard.tripSeconds);
  return route;
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
 * Both modes spend each junction's D_min as the backend does: a rolling slowdown over the approach
 * (never before the previous junction), extended past the line to respect the floor, so the trip
 * priority trip still takes `greenwaveSeconds`. Junctions in `plan.fallback` (their
 * priority request failed) retain D_min and additionally decide on the ordinary
 * programme at simulated time (timeline seconds + `plan.colorOffsetSeconds`). A rebuilt timeline
 * resumes from `cursor`, so the driven past never changes.
 */
function mockTimeline(
  route: SimulationStartResponse,
  request: SimulationStartRequest,
  greenwaveSeconds: number,
  plan: MockTimelinePlan = PRIORITY_PLAN,
  cursor?: MockCursor,
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
  const ordinaryMps = Math.min(ambulanceMps, MOCK_ORDINARY_SPEED_LIMIT_MPS);
  const legs: MockLeg[] = cursor ? [...cursor.legs] : [];
  const reachSeconds: number[] = cursor ? [...cursor.reachSeconds] : [];
  let [seconds, meters, crossing, cautious, slowed] = cursor
    ? [cursor.seconds, cursor.meters, cursor.crossingMeters, cursor.cautiousSeconds, cursor.slowed]
    : [0, 0, 0, 0, 0];
  let standard = cursor?.standard ?? false;
  let slowdownOwner = cursor?.slowdownOwner ?? null;
  let standardMeters = cursor?.standardMeters ?? 0;
  let standardSeconds = cursor?.standardSeconds ?? 0;
  // Signal decisions replace only the cautious budget, preserving the common slowdown.
  const decide = (index: number) => {
    void index;
    if (routeMovementColor(seconds + plan.colorOffsetSeconds) === "GREEN") {
      [standardMeters, standardSeconds, standard] = [0, 0, false];
      return;
    }
    const [length, extra] = standardCrossing(ordinaryMps, request.traffic_density_multiplier);
    [standardMeters, standardSeconds] = [length, extra];
    standard = true;
  };
  plan.decideAtStart?.forEach(decide);
  while (meters < total) {
    const next = stops[reachSeconds.length];
    let windowStart = Infinity;
    if (next !== undefined && slowed === reachSeconds.length) {
      windowStart = Math.max(stops[slowed - 1] ?? 0, next - MOCK_GREENWAVE_APPROACH_DISTANCE_M);
      if (meters >= windowStart) {
        windowStart = Infinity;
        slowdownOwner = slowed;
        slowed += 1;
        const needed =
          ambulanceMps > MOCK_MIN_ROLLING_SPEED_MPS
            ? delay / (1 / MOCK_MIN_ROLLING_SPEED_MPS - 1 / ambulanceMps)
            : 0;
        crossing = Math.min(crossing + Math.max(next - meters, needed), total - meters);
        cautious += delay;
      }
    }
    const speedMps =
      1 /
      (1 / (standardMeters > 0 ? ordinaryMps : ambulanceMps) +
        (crossing > 0 ? cautious / crossing : 0) +
        (standardMeters > 0 ? standardSeconds / standardMeters : 0));
    const end = Math.min(
      total,
      next ?? Infinity,
      windowStart,
      crossing > 0 ? meters + crossing : Infinity,
      standardMeters > 0 ? meters + standardMeters : Infinity,
    );
    const endSeconds = seconds + (end - meters) / speedMps;
    legs.push({
      startSeconds: seconds,
      startMeters: meters,
      endSeconds,
      speedMps,
      crossing: crossing > 0 || standardMeters > 0,
      crossingMeters: crossing,
      cautiousSeconds: cautious,
      standardMeters,
      standardSeconds,
      standard,
      slowed,
      slowdownOwner,
    });
    if (crossing > 0) {
      cautious -= (cautious * (end - meters)) / crossing;
      crossing -= end - meters;
      if (crossing <= 1e-9) [crossing, cautious] = [0, 0];
    }
    if (standardMeters > 0) {
      standardSeconds -= (standardSeconds * (end - meters)) / standardMeters;
      standardMeters -= end - meters;
      if (standardMeters <= 1e-9) [standardMeters, standardSeconds, standard] = [0, 0, false];
    }
    [seconds, meters] = [endSeconds, end];
    if (meters === next) {
      reachSeconds.push(seconds);
      if (!enabled || plan.fallback.has(reachSeconds.length - 1)) decide(reachSeconds.length - 1);
    }
  }
  return { legs, reachSeconds, tripSeconds: seconds };
}

/** The timeline driven up to `seconds`, with the crossing state there; null once arrived. */
function cursorAt(timeline: MockTimeline, seconds: number): MockCursor | null {
  const index = timeline.legs.findIndex(
    (leg) => seconds >= leg.startSeconds && seconds < leg.endSeconds,
  );
  if (index < 0) return null;
  const leg = timeline.legs[index];
  const step = (seconds - leg.startSeconds) * leg.speedMps;
  const crossing = leg.crossingMeters > 0 ? Math.max(0, leg.crossingMeters - step) : 0;
  return {
    seconds,
    meters: leg.startMeters + step,
    crossingMeters: crossing,
    cautiousSeconds: crossing > 0 ? (leg.cautiousSeconds * crossing) / leg.crossingMeters : 0,
    standardMeters: Math.max(0, leg.standardMeters - step),
    standardSeconds:
      leg.standardMeters > 0
        ? (leg.standardSeconds * Math.max(0, leg.standardMeters - step)) / leg.standardMeters
        : 0,
    standard: leg.standardMeters > step && leg.standard,
    slowed: leg.slowed,
    slowdownOwner: leg.slowdownOwner,
    legs: [
      ...timeline.legs.slice(0, index),
      ...(seconds > leg.startSeconds ? [{ ...leg, endSeconds: seconds }] : []),
    ],
    reachSeconds: timeline.reachSeconds.filter((reach) => reach <= seconds),
  };
}

/**
 * Failed requests put their unpassed targets into fallback, from the next tick on (the backend
 * moves under the previous report too). The rest of the drive is rebuilt from where the vehicle
 * is; a junction it is held at decides by the ordinary programme at release.
 */
function applyFallback(session: MockSession, passed: boolean[]): void {
  if (session.request.green_wave_mode === "DISABLED") return;
  const failed = session.controller.requests
    .filter((r) => FAILED_STATUSES.has(r.status))
    .flatMap((r) =>
      r.intersections_group.map((id) => session.route.intersections_on_route.indexOf(id)),
    )
    .filter((i) => i >= 0 && !passed[i] && !session.fallback.has(i));
  const offset = session.elapsedSeconds - session.driveSeconds;
  if (!failed.length && (!session.fallback.size || offset === session.colorOffsetSeconds)) return;
  const cursor = cursorAt(session.timeline, session.driveSeconds);
  failed.forEach((i) => session.fallback.add(i));
  session.colorOffsetSeconds = offset;
  if (!cursor) return;
  session.timeline = mockTimeline(
    session.route,
    session.request,
    session.greenwaveSeconds,
    {
      fallback: session.fallback,
      colorOffsetSeconds: offset,
      decideAtStart: failed.filter(
        (i) => session.timeline.reachSeconds[i] === session.driveSeconds,
      ),
    },
    cursor,
  );
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

/** Standard run time to the priority vehicle's current route position. */
function standardSecondsAt(session: MockSession, meters: number): number {
  for (const leg of session.standardTimeline.legs) {
    const endMeters = leg.startMeters + (leg.endSeconds - leg.startSeconds) * leg.speedMps;
    if (meters <= endMeters) return leg.startSeconds + (meters - leg.startMeters) / leg.speedMps;
  }
  return session.standardTimeline.tripSeconds;
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
} {
  const enteredClearing = new Set<number>();
  session.tick += 1;
  session.intervalStartSeconds = session.driveSeconds;
  session.elapsedSeconds += 1;
  let nextDrive = session.driveSeconds + 1;
  if (session.request.green_wave_mode !== "DISABLED") {
    const blocked = session.route.route_intersections.find(
      (i, n) =>
        !session.fallback.has(n) &&
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
  applyFallback(session, passed);
  stepMockSignals(session, enteredClearing);
  const dispatch = buildMockDispatch(session, enteredClearing, timestamp, Date.now());
  if (dispatch) session.controller.submit(dispatch, session.elapsedSeconds);
  const tick = buildMockTick(session, timestamp);
  const completed =
    routeProgress(session) === 1 && session.signals.every((s) => s.state === "NORMAL");
  return { tick, dispatch, completed, feedbacks };
}

/** Route-order ids of the junctions crossed under standard fallback. */
export function mockFallbackIds(session: MockSession): string[] {
  return session.route.intersections_on_route.filter((_, i) => session.fallback.has(i));
}

/**
 * Simulated seconds of the drive so far: held seconds count, and recovery after arrival does not.
 * Holds put the timeline behind the simulated clock by `elapsed - drive`.
 */
function travelSeconds(session: MockSession): number {
  const held = session.elapsedSeconds - session.driveSeconds;
  return Math.min(session.elapsedSeconds, session.timeline.tripSeconds + held);
}

export function buildMockTick(session: MockSession, timestamp: string): SimulationTickEvent {
  const { route, request } = session;
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
        crossing_strategy:
          request.green_wave_mode === "DISABLED"
            ? null
            : session.fallback.has(index)
              ? "STANDARD_FALLBACK"
              : "PRIORITY",
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
      current_time_saved_sec:
        session.request.green_wave_mode === "DISABLED"
          ? 0
          : Math.round(standardSecondsAt(session, progress * route.total_distance_m)) -
            Math.round(travelSeconds(session)),
      // Held seconds count; signal recovery keeps ticking after arrival but adds no travel time.
      total_time_elapsed_sec: Math.round(travelSeconds(session)),
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
      // Wall-clock arrival: `playback_speed` simulated seconds pass per real second.
      expected_arrival_utc: new Date(
        nowMs + (Math.min(...ttis) * 1000) / (request.playback_speed ?? 1),
      ).toISOString(),
    },
  };
}

/** Request selection only; reported traffic belongs to the synthetic controller. */
export function stepMockSignals(session: MockSession, selected: Set<number>): void {
  if (session.request.green_wave_mode === "DISABLED") return;
  // Failed targets stay reserved: a failed request is never repeated.
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
