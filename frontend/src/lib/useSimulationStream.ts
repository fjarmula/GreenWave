"use client";

import { useEffect } from "react";
import { positionOnRoute } from "@/lib/route-position";
import { useSimulationDispatch, useSimulationState } from "@/components/simulation-provider";
import type {
  SimulationStartRequest,
  SimulationStartResponse,
  SimulationTick,
} from "@/types/telemetry";

// Synthetic demo values from the architecture example, not calculated road routing.
export function createMockRoute(request: SimulationStartRequest): SimulationStartResponse {
  return {
    status: "INITIALIZED",
    route_geometry: {
      type: "LineString",
      coordinates: [
        [request.origin.lng, request.origin.lat],
        [request.destination.lng, request.destination.lat],
      ],
    },
    total_distance_m: 5400,
    estimated_normal_time_sec: Math.round((780 * request.traffic_density_multiplier) / 1.5),
    estimated_greenwave_time_sec: 380,
    intersections_on_route: ["INT-302", "INT-303"],
  };
}

export function createMockTick(
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
      position: {
        lat: position[1],
        lng: position[0],
      },
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

export function startMockStream(
  request: SimulationStartRequest,
  route: SimulationStartResponse,
  onTick: (tick: SimulationTick) => void,
  onFinish: () => void,
) {
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    onTick(createMockTick(request, route, tick));
    if (tick >= route.estimated_greenwave_time_sec) {
      clearInterval(timer);
      onFinish();
    }
  }, 1000);
  return () => clearInterval(timer);
}

export function useSimulationStream() {
  const { simulationState, startRequest, routeData } = useSimulationState();
  const dispatch = useSimulationDispatch();
  useEffect(() => {
    if (simulationState !== "RUNNING" || !startRequest || !routeData) return;
    return startMockStream(
      startRequest,
      routeData,
      (telemetry) => dispatch({ type: "TICK", telemetry }),
      () => dispatch({ type: "FINISH" }),
    );
  }, [dispatch, routeData, simulationState, startRequest]);
}
