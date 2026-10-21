/**
 * Synthetic values used by the frontend-only demonstration (offline fallback,
 * D22). Backend runs replace all of these with real route data and telemetry.
 */
import type { RouteIntersection } from "@/types/telemetry";

export const DEFAULT_TRAFFIC_DENSITY_MULTIPLIER = 1.5;
export const MOCK_NORMAL_TRAVEL_TIME_SECONDS = 780;
export const MOCK_GREENWAVE_TRAVEL_TIME_SECONDS = 380;
export const MOCK_ROUTE_DISTANCE_METERS = 5400;
export const MOCK_STREAM_INTERVAL_MILLISECONDS = 1000;

// Mirrors of the architecture thresholds, used only by the mock's scripted timeline.
export const MOCK_CLEARING_TTI_SECONDS = 40;
export const MOCK_PRIORITY_GREEN_TTI_SECONDS = 25;
export const MOCK_RECOVERY_SECONDS = 15;
export const MOCK_MIN_HOLD_SECONDS = 40;
export const MOCK_HOLD_BUFFER_SECONDS = 5;

// Mirrors of the backend's PoC signal programme and ER Green Wave disabled crossing, used only by
// the mock: two movement groups (green, yellow, all-red), and a clearance wait of the default
// signalised-junction delay x traffic density at each intersection (no priority, no dispatch).
export const MOCK_SIGNAL_GREEN_SECONDS = 30;
export const MOCK_SIGNAL_YELLOW_SECONDS = 3;
export const MOCK_SIGNAL_ALL_RED_SECONDS = 2;
export const MOCK_STANDARD_CLEARANCE_SECONDS = 35;

/**
 * Real ids and names from the architecture example (Aleja 29 Listopada, about
 * 152 m apart). Positions are synthetic: the mock places them on its straight
 * line at these distances, not at the real junction coordinates.
 */
export const MOCK_SAMPLE_INTERSECTIONS: ReadonlyArray<
  Pick<
    RouteIntersection,
    | "id"
    | "name"
    | "kind"
    | "distance_along_route_m"
    | "signal_count"
    | "approach_count"
    | "needs_review"
  >
> = [
  {
    id: "INT-0360",
    name: "Aleja 29 Listopada / Lublańska / Opolska",
    kind: "signalised_junction",
    distance_along_route_m: 1480,
    signal_count: 3,
    approach_count: 3,
    needs_review: false,
  },
  {
    id: "INT-0366",
    name: "Aleja 29 Listopada / Jana Woronicza",
    kind: "signalised_junction",
    distance_along_route_m: 1632,
    signal_count: 1,
    approach_count: 2,
    needs_review: true,
  },
];

export function estimateMockNormalTravelTimeSeconds(trafficDensityMultiplier: number): number {
  return Math.round(
    (MOCK_NORMAL_TRAVEL_TIME_SECONDS * trafficDensityMultiplier) /
      DEFAULT_TRAFFIC_DENSITY_MULTIPLIER,
  );
}
