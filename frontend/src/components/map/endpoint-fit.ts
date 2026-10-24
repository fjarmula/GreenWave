import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { measureMapPadding } from "@/components/map/occluders";

/** The visible map area, as MapLibre's `getBounds()` reports it. */
export type ViewBounds = { west: number; south: number; east: number; north: number };

/**
 * Whether choosing an endpoint should move the camera. Only an explicit focus request or an
 * endpoint the user cannot see does; otherwise their zoom and position are kept.
 */
export function endpointFitDecision({
  points,
  viewBounds,
  focusRequested,
}: {
  points: ReadonlyArray<[lng: number, lat: number]>;
  viewBounds: ViewBounds;
  focusRequested: boolean;
}): "none" | "fit" {
  if (points.length === 0) return "none";
  if (focusRequested) return "fit";
  const { west, south, east, north } = viewBounds;
  const inView = ([lng, lat]: [number, number]) =>
    lng >= west && lng <= east && lat >= south && lat <= north;
  return points.every(inView) ? "none" : "fit";
}

const FOCUS_FIT_DURATION_MILLISECONDS = 600;

/** `fitBounds` on a zero-size container produces `Invalid LngLat (NaN, NaN)`. */
export function canFit(map: Map): boolean {
  const { clientWidth, clientHeight } = map.getContainer();
  return clientWidth > 0 && clientHeight > 0;
}

/** Fits the station and incident when `endpointFitDecision` says so. */
export function applyEndpointFit(
  map: Map,
  {
    points,
    focusRequested,
    reduceMotion,
  }: {
    points: ReadonlyArray<[lng: number, lat: number]>;
    focusRequested: boolean;
    reduceMotion: boolean;
  },
): void {
  if (!canFit(map)) return;
  const view = map.getBounds();
  const viewBounds = {
    west: view.getWest(),
    south: view.getSouth(),
    east: view.getEast(),
    north: view.getNorth(),
  };
  if (endpointFitDecision({ points, viewBounds, focusRequested }) === "none") return;
  const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
  points.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, {
    padding: measureMapPadding(map.getContainer()),
    maxZoom: points.length > 1 ? 13.2 : 14,
    duration: reduceMotion ? 0 : FOCUS_FIT_DURATION_MILLISECONDS,
  });
}
