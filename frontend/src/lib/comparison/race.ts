import { formatSignalDistance } from "@/lib/driver-presentation";
import { distanceAlongRoute, routeLengthMeters } from "@/lib/route-position";
import type { SimulationState } from "@/lib/simulation-state";
import type { SimulationStartResponse } from "@/types/telemetry";

export type ComparisonMode = "ENABLED" | "DISABLED";
export type ComparisonRuns = Record<ComparisonMode, SimulationState>;

export type RaceStanding = {
  leader: ComparisonMode | "LEVEL";
  /** Green Wave distance minus standard-traffic distance, metres (negative: standard leads). */
  leadM: number;
  /** The run that arrived first, once one has. */
  arrived: ComparisonMode | null;
  /** Share of the route driven, 0–1. */
  positions: Record<ComparisonMode, number>;
  /** Both vehicles arrived, even while signals are still recovering. */
  bothArrived: boolean;
};

/** Closer than this, the race reads as level. */
const LEVEL_WITHIN_M = 10;

/** Physical arrival is visible in ticks before the run's recovery terminal. */
export function arrivalTimeSeconds(run: SimulationState): number | null {
  if (run.completion) return run.completion.kpi_metrics.total_time_elapsed_sec;
  return run.liveTelemetry?.ambulance.status === "ARRIVED"
    ? run.liveTelemetry.kpi_metrics.total_time_elapsed_sec
    : null;
}

/** Measured distance only, never a projected time. A stale run keeps its last position. */
export function raceStanding(route: SimulationStartResponse, runs: ComparisonRuns): RaceStanding {
  const geometry = route.route_geometry;
  const total = routeLengthMeters(geometry);
  const driven = (run: SimulationState) => {
    if (arrivalTimeSeconds(run) !== null) return total;
    const position = run.liveTelemetry?.ambulance.position;
    if (!position) return 0;
    return Math.min(total, distanceAlongRoute(geometry, [position.lng, position.lat]) ?? 0);
  };
  const enabled = driven(runs.ENABLED);
  const disabled = driven(runs.DISABLED);
  const leadM = enabled - disabled;
  const enabledArrival = arrivalTimeSeconds(runs.ENABLED);
  const disabledArrival = arrivalTimeSeconds(runs.DISABLED);
  const arrived: ComparisonMode | null =
    enabledArrival !== null && disabledArrival !== null
      ? enabledArrival <= disabledArrival
        ? "ENABLED"
        : "DISABLED"
      : enabledArrival !== null
        ? "ENABLED"
        : disabledArrival !== null
          ? "DISABLED"
          : null;
  return {
    leader: Math.abs(leadM) < LEVEL_WITHIN_M ? "LEVEL" : leadM > 0 ? "ENABLED" : "DISABLED",
    leadM,
    arrived,
    bothArrived: enabledArrival !== null && disabledArrival !== null,
    positions: {
      ENABLED: total > 0 ? enabled / total : 0,
      DISABLED: total > 0 ? disabled / total : 0,
    },
  };
}

export function raceReadout(standing: RaceStanding): string {
  if (standing.bothArrived) return "Both arrived";
  const gap = formatSignalDistance(Math.abs(standing.leadM));
  if (standing.arrived === "ENABLED") return `Green Wave arrived · standard traffic ${gap} behind`;
  if (standing.arrived === "DISABLED") return `Standard traffic arrived · Green Wave ${gap} behind`;
  if (standing.leader === "ENABLED") return `Green Wave ahead by ${gap}`;
  if (standing.leader === "DISABLED") return `Standard traffic ahead by ${gap}`;
  return "Level";
}

export function comparisonResultLabel(delta: number) {
  return delta === 0
    ? "same travel time"
    : delta > 0
      ? "Green Wave faster"
      : "standard traffic faster";
}

export type ComparisonResult = {
  enabledSeconds: number;
  disabledSeconds: number;
  /** Standard-traffic time minus Green Wave time, simulated seconds. */
  delta: number;
  label: string;
  /** Route intersections that reached PRIORITY_GREEN in the Green Wave run. */
  prioritised: number;
  total: number;
};

/** Both actual arrival times; null until both runs completed. */
export function comparisonResult(
  runs: ComparisonRuns,
  priorityIds: readonly string[],
  route: SimulationStartResponse,
): ComparisonResult | null {
  const enabled = runs.ENABLED.completion;
  const disabled = runs.DISABLED.completion;
  if (!enabled || !disabled) return null;
  const enabledSeconds = enabled.kpi_metrics.total_time_elapsed_sec;
  const disabledSeconds = disabled.kpi_metrics.total_time_elapsed_sec;
  const delta = disabledSeconds - enabledSeconds;
  const onRoute = new Set(route.route_intersections.map((intersection) => intersection.id));
  return {
    enabledSeconds,
    disabledSeconds,
    delta,
    label: comparisonResultLabel(delta),
    prioritised: new Set(priorityIds.filter((id) => onRoute.has(id))).size,
    total: onRoute.size,
  };
}
