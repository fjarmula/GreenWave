import type { RouteGeometry } from "@/types/telemetry";

/** Demo interpolation by segment index, not road distance or geographic routing. */
export function positionOnRoute(route: RouteGeometry, progress: number): [number, number] | null {
  const coordinates = route.coordinates;
  if (coordinates.length < 2) return null;
  const segmentProgress = Math.max(0, Math.min(1, progress)) * (coordinates.length - 1);
  const index = Math.min(Math.floor(segmentProgress), coordinates.length - 2);
  const fraction = segmentProgress - index;
  const from = coordinates[index];
  const to = coordinates[index + 1];
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
}
