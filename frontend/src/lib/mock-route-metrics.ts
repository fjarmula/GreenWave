import {
  DEFAULT_TRAFFIC_DENSITY_MULTIPLIER,
  MOCK_REFERENCE_DISTANCE_METERS,
  MOCK_REFERENCE_GREENWAVE_SECONDS,
  MOCK_REFERENCE_NORMAL_SECONDS,
} from "@/lib/mock-simulation-config";
import type { Position } from "@/types/telemetry";

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export type MockRouteMetrics = {
  distanceMeters: number;
  normalSeconds: number;
  greenwaveSeconds: number;
};

/** Synthetic straight-line estimates, not drivable routes or real response-time predictions. */
export function estimateMockRoute(
  origin: Position,
  destination: Position,
  trafficDensityMultiplier: number,
): MockRouteMetrics {
  const distanceMeters = haversineMeters(origin, destination);
  const scale = distanceMeters / MOCK_REFERENCE_DISTANCE_METERS;
  return {
    distanceMeters,
    normalSeconds:
      (scale * MOCK_REFERENCE_NORMAL_SECONDS * trafficDensityMultiplier) /
      DEFAULT_TRAFFIC_DENSITY_MULTIPLIER,
    greenwaveSeconds: scale * MOCK_REFERENCE_GREENWAVE_SECONDS,
  };
}
