/**
 * Synthetic values used by the frontend-only demonstration. Replace this
 * module when route estimates and telemetry are supplied by the backend.
 */
export const DEFAULT_TRAFFIC_DENSITY_MULTIPLIER = 1.5;
export const MOCK_NORMAL_TRAVEL_TIME_SECONDS = 780;
export const MOCK_GREENWAVE_TRAVEL_TIME_SECONDS = 380;
export const MOCK_ROUTE_DISTANCE_METERS = 5400;
export const MOCK_STREAM_INTERVAL_MILLISECONDS = 1000;

export function estimateMockNormalTravelTimeSeconds(trafficDensityMultiplier: number): number {
  return Math.round(
    (MOCK_NORMAL_TRAVEL_TIME_SECONDS * trafficDensityMultiplier) /
      DEFAULT_TRAFFIC_DENSITY_MULTIPLIER,
  );
}
