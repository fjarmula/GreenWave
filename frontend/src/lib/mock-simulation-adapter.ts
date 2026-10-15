import {
  estimateMockNormalTravelTimeSeconds,
  MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
  MOCK_ROUTE_DISTANCE_METERS,
  MOCK_STREAM_INTERVAL_MILLISECONDS,
} from "@/lib/mock-simulation-config";
import { positionOnRoute } from "@/lib/route-position";
import type { SimulationAdapter, SimulationStreamSubscriber } from "@/lib/simulation-adapter";
import type {
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTick,
} from "@/types/telemetry";

type MockSession = {
  request: SimulationStartRequest;
  route: SimulationStartResponse;
  tick: number;
};

export function createMockSimulationAdapter(): SimulationAdapter {
  let session: MockSession | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subscribers = new Set<SimulationStreamSubscriber>();

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const emitNextTick = () => {
    if (!session) return;
    session.tick += 1;
    const telemetry = createMockTick(session.request, session.route, session.tick);
    subscribers.forEach((subscriber) => subscriber.onTick(telemetry));

    if (session.tick >= session.route.estimated_greenwave_time_sec) {
      stopTimer();
      subscribers.forEach((subscriber) => subscriber.onComplete());
    }
  };

  const startTimer = () => {
    if (!session || timer || subscribers.size === 0) return;
    timer = setInterval(emitNextTick, MOCK_STREAM_INTERVAL_MILLISECONDS);
  };

  return {
    async start(request) {
      stopTimer();
      const route = createMockRoute(request);
      session = { request, route, tick: 0 };
      return route;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      startTimer();

      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) stopTimer();
      };
    },
    stop() {
      stopTimer();
      session = null;
      subscribers.clear();
    },
  };
}

function createMockRoute(request: SimulationStartRequest): SimulationStartResponse {
  return {
    status: "INITIALIZED",
    route_geometry: {
      type: "LineString",
      coordinates: [
        [request.origin.lng, request.origin.lat],
        [request.destination.lng, request.destination.lat],
      ],
    },
    total_distance_m: MOCK_ROUTE_DISTANCE_METERS,
    estimated_normal_time_sec: estimateMockNormalTravelTimeSeconds(
      request.traffic_density_multiplier,
    ),
    estimated_greenwave_time_sec: MOCK_GREENWAVE_TRAVEL_TIME_SECONDS,
    intersections_on_route: ["INT-302", "INT-303"],
  };
}

function createMockTick(
  request: SimulationStartRequest,
  route: SimulationStartResponse,
  tick: number,
): SimulationTick {
  const progress = Math.min(1, tick / route.estimated_greenwave_time_sec);
  const position = positionOnRoute(route.route_geometry, progress);
  if (!position) throw new Error("Mock simulation requires at least two route coordinates");

  return {
    event_type: "SIMULATION_TICK",
    tick,
    timestamp: new Date().toISOString(),
    ambulance: {
      id: "AMB-KRA-01",
      position: { lat: position[1], lng: position[0] },
      speed_kmh: progress === 1 ? 0 : Number((62.4 + Math.sin(tick / 5) * 3).toFixed(1)),
      status: progress === 1 ? "ARRIVED" : "APPROACHING_INTERSECTION",
    },
    kpi_metrics: {
      current_time_saved_sec: Math.round(
        Math.max(0, route.estimated_normal_time_sec - route.estimated_greenwave_time_sec) *
          progress,
      ),
      total_time_elapsed_sec: tick,
    },
    // Sample snapshots: backend signal transition logic is not implemented here.
    intersections: [
      {
        id: "INT-302",
        name: "Aleje / Czarnowiejska",
        state: "CLEARING",
        tti_seconds: Math.max(0, 28 - tick),
        is_active_corridor: true,
      },
      {
        id: "INT-303",
        name: "Aleje / Reymonta",
        state: request.enable_cascade_mode ? "CLEARING_CASCADE" : "NORMAL",
        tti_seconds: Math.max(0, 38 - tick),
        is_active_corridor: request.enable_cascade_mode,
      },
    ],
  };
}
