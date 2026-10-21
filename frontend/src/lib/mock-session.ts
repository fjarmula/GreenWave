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
} from "@/lib/mock-simulation-config";
import { positionOnRoute } from "@/lib/route-position";
import type {
  IntersectionState,
  IntersectionTelemetry,
  ItsDispatchEvent,
  Position,
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

const MOCK_CASCADE_DISTANCE_METERS = 250;

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
};

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

function arrivalSeconds(route: SimulationStartResponse, index: number): number {
  return (
    (route.route_intersections[index].distance_along_route_m / route.total_distance_m) *
    route.estimated_greenwave_time_sec
  );
}

function routeProgress(session: MockSession): number {
  return Math.min(1, session.elapsedSeconds / session.route.estimated_greenwave_time_sec);
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
          : Math.max(0, Math.round(arrivalSeconds(route, index) - elapsed)),
        is_active_corridor: signal.state === "CLEARING" || signal.state === "PRIORITY_GREEN",
      };
    },
  );
  const nextSignal = intersections.find((intersection) => intersection.tti_seconds !== null);
  const arrived = progress === 1;

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
      speed_kmh: arrived ? 0 : Number((62.4 + Math.sin(session.tick / 5) * 3).toFixed(1)),
      status: arrived
        ? "ARRIVED"
        : nextSignal?.is_active_corridor
          ? "APPROACHING_INTERSECTION"
          : "EN_ROUTE",
    },
    kpi_metrics: {
      current_time_saved_sec: Math.round(
        Math.max(0, route.estimated_normal_time_sec - route.estimated_greenwave_time_sec) *
          progress,
      ),
      total_time_elapsed_sec: elapsed,
    },
    intersections,
    signal_phases: [],
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
    Math.max(0, arrivalSeconds(route, index) - session.elapsedSeconds),
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

  signals.forEach((signal, index) => {
    const tti = arrivalSeconds(route, index) - elapsedSeconds;
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
