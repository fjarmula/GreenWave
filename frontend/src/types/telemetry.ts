/**
 * Temporary frontend contracts for the F3–F5 mock workflow, translated from
 * GreenWave_ARCHITECTURE.md §4. The backend currently exports only HealthResponse.
 * Replace these declarations with api.generated.ts aliases when the canonical
 * simulation schemas are available; do not maintain a second wire contract.
 * These types do not validate untrusted transport payloads at runtime.
 */
export type Position = {
  lat: number;
  lng: number;
};

export type RouteGeometry = {
  type: "LineString";
  coordinates: [longitude: number, latitude: number][];
};

export type SimulationStartRequest = {
  simulation_id: string;
  origin: Position;
  destination: Position;
  traffic_density_multiplier: number;
  enable_cascade_mode: boolean;
};

export type SimulationStartResponse = {
  status: "INITIALIZED";
  route_geometry: RouteGeometry;
  total_distance_m: number;
  estimated_normal_time_sec: number;
  estimated_greenwave_time_sec: number;
  intersections_on_route: string[];
};

export type SignalState =
  "NORMAL" | "CLEARING" | "CLEARING_CASCADE" | "PRIORITY_GREEN" | "RECOVERY";

export type AmbulanceTelemetry = {
  id: string;
  position: Position;
  speed_kmh: number;
  // The architecture gives an example, but does not define a status enum.
  status: string;
};

export type KpiMetrics = {
  current_time_saved_sec: number;
  total_time_elapsed_sec: number;
};

export type IntersectionTelemetry = {
  id: string;
  name: string;
  state: SignalState;
  tti_seconds: number;
  is_active_corridor: boolean;
};

export type SimulationTick = {
  event_type: "SIMULATION_TICK";
  tick: number;
  timestamp: string;
  ambulance: AmbulanceTelemetry;
  kpi_metrics: KpiMetrics;
  intersections: IntersectionTelemetry[];
};
