/**
 * Synthetic values used by the frontend-only demonstration (offline fallback,
 * D22). Backend runs replace all of these with real route data and telemetry.
 */
import type { RouteIntersection } from "@/types/telemetry";

export const DEFAULT_TRAFFIC_DENSITY_MULTIPLIER = 1.5;
export const MOCK_REFERENCE_NORMAL_SECONDS = 780;
export const MOCK_REFERENCE_GREENWAVE_SECONDS = 380;
export const MOCK_REFERENCE_DISTANCE_METERS = 5400;

// Mirrors of the architecture thresholds, used only by the mock's scripted timeline.
export const MOCK_CLEARING_TTI_SECONDS = 40;
export const MOCK_PRIORITY_GREEN_TTI_SECONDS = 25;
export const MOCK_RECOVERY_SECONDS = 15;
export const MOCK_MIN_HOLD_SECONDS = 40;
export const MOCK_HOLD_BUFFER_SECONDS = 5;
// Mirrors of the backend's common D_min slowdown (both modes and fallback) (simulation/motion.py): D_min is spent
// rolling over the approach to each junction, never below the floor, never as a stop.
export const MOCK_MIN_INTERSECTION_DELAY_SECONDS = 3;
export const MOCK_GREENWAVE_APPROACH_DISTANCE_M = 60;
export const MOCK_MIN_ROLLING_SPEED_MPS = 15 / 3.6;

// Mirrors of the backend's PoC signal programme and ER Green Wave disabled crossing, used only by
// the mock: two movement groups (green, yellow, all-red). Facing a red or yellow route movement,
// a disabled vehicle rolls at no more than the synthetic ordinary limit, spreading the default
// signalised-junction delay x traffic density (capped at MOCK_STANDARD_MAX_RED_LOSS_SECONDS) over
// at least MOCK_STANDARD_CROSSING_DISTANCE_M, extended so it never drops below
// MOCK_STANDARD_MIN_ROLLING_SPEED_MPS; on green it drives on (no priority, no dispatch). The
// backend scales the loss by the seconds until green; the mock uses the fixed delay as that wait
// (contract level, it has no seconds-until-green helper). Synthetic values, not route data.
export const MOCK_SIGNAL_GREEN_SECONDS = 30;
export const MOCK_SIGNAL_YELLOW_SECONDS = 3;
export const MOCK_SIGNAL_ALL_RED_SECONDS = 2;
export const MOCK_STANDARD_CLEARANCE_SECONDS = 35;
export const MOCK_STANDARD_CROSSING_DISTANCE_M = 30;
export const MOCK_ORDINARY_SPEED_LIMIT_MPS = 50 / 3.6;
export const MOCK_STANDARD_MIN_ROLLING_SPEED_MPS = 10 / 3.6;
export const MOCK_STANDARD_MAX_RED_LOSS_SECONDS = 15;

/** Synthetic junctions projected at fixed fractions of each straight mock line. */
export const MOCK_SAMPLE_INTERSECTIONS: ReadonlyArray<
  Pick<
    RouteIntersection,
    "id" | "name" | "kind" | "signal_count" | "approach_count" | "needs_review"
  > & { routeFraction: number }
> = [
  {
    id: "INT-9001",
    name: "Mock junction A",
    kind: "signalised_junction",
    routeFraction: 1480 / MOCK_REFERENCE_DISTANCE_METERS,
    signal_count: 3,
    approach_count: 3,
    needs_review: false,
  },
  {
    id: "INT-9002",
    name: "Mock junction B",
    kind: "signalised_junction",
    routeFraction: 1632 / MOCK_REFERENCE_DISTANCE_METERS,
    signal_count: 1,
    approach_count: 2,
    needs_review: true,
  },
];
