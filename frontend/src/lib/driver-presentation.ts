import { distanceAlongRoute } from "@/lib/route-position";
import type { DispatchSettings } from "@/lib/start-request";
import type {
  IntersectionState,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

export type NextSignal = {
  intersectionId: string;
  name: string | null;
  state: IntersectionState;
  distanceM: number;
};

/**
 * The next route intersection the vehicle has not passed (the first with a TTI) and its
 * distance ahead. Null without fresh telemetry: a stale distance would be wrong.
 */
export function nextSignal(
  route: SimulationStartResponse,
  tick: SimulationTickEvent | null,
  stale: boolean,
): NextSignal | null {
  if (stale || !tick) return null;
  const ahead = tick.intersections.find((intersection) => intersection.tti_seconds !== null);
  if (!ahead) return null;
  const onRoute = route.route_intersections.find((entry) => entry.id === ahead.id);
  const { lng, lat } = tick.ambulance.position;
  const travelled = distanceAlongRoute(route.route_geometry, [lng, lat]);
  if (!onRoute || travelled === null) return null;
  const distanceM = onRoute.distance_along_route_m - travelled;
  if (distanceM < 0) return null;
  return { intersectionId: ahead.id, name: onRoute.name ?? null, state: ahead.state, distanceM };
}

/** "180 m" (nearest 10 m) below a kilometre, "1.2 km" above. */
export function formatSignalDistance(meters: number): string {
  const rounded = Math.round(meters / 10) * 10;
  if (rounded < 1000) return `${rounded} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const SIGNAL_COPY: Record<IntersectionState, string> = {
  PRIORITY_GREEN: "Green",
  CLEARING: "Clearing",
  NORMAL: "Ordinary signal",
  RECOVERY: "Recovery",
};

export function nextSignalCopy(signal: NextSignal): string {
  return `${SIGNAL_COPY[signal.state]} in ${formatSignalDistance(signal.distanceM)}`;
}

/** Simulated seconds left on the run's own estimate. */
export function etaSeconds(route: SimulationStartResponse, tick: SimulationTickEvent | null) {
  const estimate =
    route.green_wave_mode === "DISABLED"
      ? route.estimated_normal_time_sec
      : route.estimated_greenwave_time_sec;
  return Math.max(0, estimate - (tick?.kpi_metrics.total_time_elapsed_sec ?? 0));
}

export function savedPill(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole === 0) return "On estimate · simulated";
  return `${Math.abs(whole)} s ${whole > 0 ? "faster" : "slower"} · simulated`;
}

export function settingsSummary(settings: DispatchSettings): string {
  return `Traffic ${settings.trafficDensity}× · Cascade ${settings.cascadeEnabled ? "on" : "off"} · ${settings.playbackSpeed}× speed`;
}
