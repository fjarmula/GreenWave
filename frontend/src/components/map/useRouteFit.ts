import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { canFit } from "@/components/map/endpoint-fit";
import { measureMapPadding } from "@/components/map/occluders";

/** Fits the whole route, clear of every overlay floating over the map. */
export function applyRouteFit(
  map: Map,
  routeCoordinates: ReadonlyArray<[lng: number, lat: number]>,
  reduceMotion: boolean,
): void {
  if (!canFit(map)) return;
  const bounds = new maplibregl.LngLatBounds(routeCoordinates[0], routeCoordinates[0]);
  routeCoordinates.forEach((coordinate) => bounds.extend(coordinate));
  map.fitBounds(bounds, {
    padding: measureMapPadding(map.getContainer()),
    maxZoom: 16,
    duration: reduceMotion ? 0 : 200,
  });
}
