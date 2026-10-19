/**
 * The JSON examples of GreenWave_ARCHITECTURE.md §4, typed against the
 * generated contract so a contract change breaks compilation, not runtime.
 */
import type {
  ErrorResponse,
  ItsDispatchEvent,
  SimulationCancelledEvent,
  SimulationCompletedEvent,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

export const SIMULATION_ID = "SIM-20261025-01";

export const startResponseExample: SimulationStartResponse = {
  schema_version: "1.0",
  is_simulated: true,
  simulation_id: SIMULATION_ID,
  status: "INITIALIZED",
  route_geometry: {
    type: "LineString",
    coordinates: [
      [19.9571, 50.0612],
      [19.9234, 50.0645],
      [19.9248, 50.0621],
    ],
  },
  total_distance_m: 5400,
  estimated_normal_time_sec: 780,
  estimated_greenwave_time_sec: 380,
  intersections_on_route: ["INT-0360", "INT-0366"],
  route_intersections: [
    {
      id: "INT-0360",
      name: "Aleja 29 Listopada / Lublańska / Opolska",
      kind: "signalised_junction",
      position: { lat: 50.0661, lng: 19.9221 },
      distance_along_route_m: 1480,
      signal_count: 4,
      approach_count: 4,
      needs_review: false,
      cascade_targets: ["INT-0366"],
    },
    {
      id: "INT-0366",
      name: "Aleja 29 Listopada / Jana Woronicza",
      kind: "signalised_junction",
      position: { lat: 50.0655, lng: 19.9243 },
      distance_along_route_m: 1632,
      signal_count: 2,
      approach_count: 2,
      needs_review: false,
      cascade_targets: [],
    },
  ],
  origin_snapped: { position: { lat: 50.0611, lng: 19.9568 }, snap_distance_m: 12.4 },
  destination_snapped: { position: { lat: 50.0136, lng: 19.9979 }, snap_distance_m: 31.7 },
};

export const tickEventExample: SimulationTickEvent = {
  schema_version: "1.0",
  is_simulated: true,
  event_type: "SIMULATION_TICK",
  simulation_id: SIMULATION_ID,
  tick: 42,
  timestamp: "2026-10-25T14:32:10Z",
  ambulance: {
    id: "AMB-KRA-01",
    position: { lat: 50.0661, lng: 19.9221 },
    speed_kmh: 62.4,
    status: "APPROACHING_INTERSECTION",
  },
  kpi_metrics: { current_time_saved_sec: 145, total_time_elapsed_sec: 42 },
  intersections: [
    {
      id: "INT-0360",
      name: "Aleja 29 Listopada / Lublańska / Opolska",
      state: "CLEARING",
      is_cascade: false,
      tti_seconds: 28,
      is_active_corridor: true,
    },
    {
      id: "INT-0366",
      name: "Aleja 29 Listopada / Jana Woronicza",
      state: "CLEARING",
      is_cascade: true,
      tti_seconds: 38,
      is_active_corridor: true,
    },
  ],
};

export const completedEventExample: SimulationCompletedEvent = {
  schema_version: "1.0",
  is_simulated: true,
  event_type: "SIMULATION_COMPLETED",
  simulation_id: SIMULATION_ID,
  tick: 383,
  timestamp: "2026-10-25T14:37:51Z",
  kpi_metrics: { current_time_saved_sec: 396, total_time_elapsed_sec: 383 },
};

export const cancelledEventExample: SimulationCancelledEvent = {
  schema_version: "1.0",
  is_simulated: true,
  event_type: "SIMULATION_CANCELLED",
  simulation_id: SIMULATION_ID,
  tick: 57,
  timestamp: "2026-10-25T14:32:25Z",
  reason: "SUPERSEDED",
};

export const itsDispatchEventExample: ItsDispatchEvent = {
  schema_version: "1.0",
  is_simulated: true,
  event_type: "ITS_DISPATCH",
  message_id: "MSG-ITS-88392",
  simulation_id: SIMULATION_ID,
  tick: 30,
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

export const errorResponseExample: ErrorResponse = {
  schema_version: "1.0",
  error_code: "ORIGIN_OFF_NETWORK",
  message: "Origin is 412 m from the nearest routable road; the limit is 150 m.",
};
