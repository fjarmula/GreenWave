import type { RouteGeometry } from "@/types/telemetry";

type LngLat = [number, number];

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

const EARTH_RADIUS_METERS = 6_371_008.8;
const RADIANS = Math.PI / 180;
// A position farther than this from the polyline is not "on the route"; animate it straight.
const MAX_OFF_ROUTE_METERS = 25;

/**
 * Local equirectangular projection around the route start: metres, accurate
 * to well under 1 % over a city-scale route, which is all an animation needs.
 */
function projector(route: RouteGeometry) {
  const cosLatitude = Math.cos(route.coordinates[0][1] * RADIANS);
  return {
    toMeters: ([lng, lat]: LngLat): LngLat => [
      lng * RADIANS * EARTH_RADIUS_METERS * cosLatitude,
      lat * RADIANS * EARTH_RADIUS_METERS,
    ],
    toLngLat: ([x, y]: LngLat): LngLat => [
      x / (RADIANS * EARTH_RADIUS_METERS * cosLatitude),
      y / (RADIANS * EARTH_RADIUS_METERS),
    ],
  };
}

/** Nearest point on the polyline: distance along it from the start and distance off it. */
function project(route: RouteGeometry, point: LngLat) {
  const { toMeters } = projector(route);
  const [px, py] = toMeters(point);
  let travelled = 0;
  let best = { along: 0, offset: Number.POSITIVE_INFINITY };
  for (let index = 0; index < route.coordinates.length - 1; index += 1) {
    const [ax, ay] = toMeters(route.coordinates[index]);
    const [bx, by] = toMeters(route.coordinates[index + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const t =
      length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length ** 2));
    const offset = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (offset < best.offset) best = { along: travelled + length * t, offset };
    travelled += length;
  }
  return best;
}

/** Metres along the route to the point's projection, or null without a usable route. */
export function distanceAlongRoute(route: RouteGeometry, point: LngLat): number | null {
  if (route.coordinates.length < 2) return null;
  return project(route, point).along;
}

/** The point `meters` along the route, clamped to its ends; null without a usable route. */
export function pointAtDistance(route: RouteGeometry, meters: number): LngLat | null {
  const coordinates = route.coordinates;
  if (coordinates.length < 2) return null;
  const { toMeters, toLngLat } = projector(route);
  let remaining = Math.max(0, meters);
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const a = toMeters(coordinates[index]);
    const b = toMeters(coordinates[index + 1]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length) {
      const t = length === 0 ? 0 : remaining / length;
      return toLngLat([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    remaining -= length;
  }
  const last = coordinates[coordinates.length - 1];
  return [last[0], last[1]];
}

/**
 * Position between two consecutive vehicle positions, moving along the route
 * polyline so the marker follows bends instead of cutting corners (visible at
 * high playback speeds). Falls back to a straight line without a route or when
 * either position is off the route.
 */
export function interpolateAlongRoute(
  route: RouteGeometry | null,
  from: LngLat,
  to: LngLat,
  fraction: number,
): LngLat {
  const t = Math.max(0, Math.min(1, fraction));
  const straight: LngLat = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  if (t === 0) return from;
  if (t === 1) return to;
  if (!route || route.coordinates.length < 2) return straight;
  const start = project(route, from);
  const end = project(route, to);
  if (start.offset > MAX_OFF_ROUTE_METERS || end.offset > MAX_OFF_ROUTE_METERS) return straight;
  return pointAtDistance(route, start.along + (end.along - start.along) * t) ?? straight;
}
