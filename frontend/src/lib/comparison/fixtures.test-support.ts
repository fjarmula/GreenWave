import {
  startResponseExample,
  tickEventExample,
  completedEventExample,
} from "@/lib/transport/__fixtures__/architecture-examples";
import type { SimulationStartRequest } from "@/types/telemetry";
export const request: SimulationStartRequest = {
  simulation_id: "pair",
  green_wave_mode: "ENABLED",
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0621, lng: 19.9248 },
  traffic_density_multiplier: 1.5,
  enable_cascade_mode: true,
  playback_speed: 10,
  vehicle_type: "AMBULANCE",
};
export const route = (id = "pair", mode: "ENABLED" | "DISABLED" = "ENABLED") => ({
  ...startResponseExample,
  simulation_id: id,
  green_wave_mode: mode,
});
export const tick = (n: number, id = "pair") => ({
  ...tickEventExample,
  simulation_id: id,
  tick: n,
  kpi_metrics: { ...tickEventExample.kpi_metrics, total_time_elapsed_sec: n },
});
export const completed = (n: number, id = "pair") => ({
  ...completedEventExample,
  simulation_id: id,
  tick: n,
  kpi_metrics: { ...completedEventExample.kpi_metrics, total_time_elapsed_sec: n },
});
