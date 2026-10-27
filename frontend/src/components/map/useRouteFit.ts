import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { CAMERA_TRANSITION_MILLISECONDS } from "@/lib/camera-motion";
import { canFit } from "@/components/map/endpoint-fit";
import { measureMapPadding } from "@/components/map/occluders";
import type { Position, SimulationStartResponse } from "@/types/telemetry";

/** The route, plus the incident when the crew walks the last leg (the walk must stay in view). */
export function routeFitCoordinates(
  route: Pick<SimulationStartResponse, "route_geometry" | "destination_on_foot">,
  incident: Position | null,
): [lng: number, lat: number][] {
  const coordinates = route.route_geometry.coordinates;
  return route.destination_on_foot && incident
    ? [...coordinates, [incident.lng, incident.lat]]
    : coordinates;
}

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
    // Ease directly between views instead of a flight arc that zooms out and back in.
    linear: true,
    duration: reduceMotion ? 0 : CAMERA_TRANSITION_MILLISECONDS,
  });
}
