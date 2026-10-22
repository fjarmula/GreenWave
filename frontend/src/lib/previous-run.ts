import type { SimulationState } from "@/lib/simulation-state";
import type { GreenWaveMode } from "@/types/telemetry";

/** The last finished run, kept in setup so the next run can be compared with it (UI state only). */
export type PreviousRun = {
  greenWaveMode: GreenWaveMode;
  totalSeconds: number;
  savedSeconds: number;
  normalEstimateSeconds: number;
  stationName: string;
  incidentLabel: string;
  trafficDensity: number;
};

/** Only a FINISHED run has a result worth comparing; anything else records nothing. */
export function toPreviousRun(
  { simulationState, startRequest, routeData, completion }: SimulationState,
  stationName: string,
  incidentLabel: string,
): PreviousRun | null {
  if (simulationState !== "FINISHED" || !startRequest || !routeData || !completion) return null;
  return {
    greenWaveMode: startRequest.green_wave_mode,
    totalSeconds: completion.kpi_metrics.total_time_elapsed_sec,
    savedSeconds: completion.kpi_metrics.current_time_saved_sec,
    normalEstimateSeconds: routeData.estimated_normal_time_sec,
    stationName,
    incidentLabel,
    trafficDensity: startRequest.traffic_density_multiplier,
  };
}

/** A stopped, cancelled or failed run leaves the last finished result in place. */
export function nextPreviousRun(
  current: PreviousRun | null,
  state: SimulationState,
  stationName: string,
  incidentLabel: string,
): PreviousRun | null {
  return toPreviousRun(state, stationName, incidentLabel) ?? current;
}
