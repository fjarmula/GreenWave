import { useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { mapPadding } from "@/lib/workspace-layout";
import { canFit } from "@/components/map/endpoint-fit";
import type { SimulationStartResponse } from "@/types/telemetry";

/** Fits the whole route, leaving room for the live HUD panels beside the map. */
export function applyRouteFit(
  map: Map,
  routeCoordinates: ReadonlyArray<[lng: number, lat: number]>,
  reduceMotion: boolean,
): void {
  if (!canFit(map)) return;
  const bounds = new maplibregl.LngLatBounds(routeCoordinates[0], routeCoordinates[0]);
  routeCoordinates.forEach((coordinate) => bounds.extend(coordinate));
  const container = map.getContainer();
  // The workspace shell marks whether its floating inspector currently covers part of the map.
  const detailsOpen =
    container.closest<HTMLElement>("[data-details]")?.dataset.details === "true" &&
    container.closest<HTMLElement>("[data-focus]")?.dataset.focus !== "true";
  map.fitBounds(bounds, {
    padding: mapPadding(container.clientWidth, container.clientHeight, detailsOpen),
    maxZoom: 16,
    duration: reduceMotion ? 0 : 200,
  });
}

export function useRouteFit(
  map: Map | null,
  live: boolean,
  routeData: SimulationStartResponse | null,
) {
  // Fit the whole route once per run (and once the live map exists); no animated fly with
  // reduced motion.
  const routeId = routeData?.simulation_id;
  const routeCoordinates = routeData?.route_geometry.coordinates;
  useEffect(() => {
    if (!map || !live || !routeCoordinates || routeCoordinates.length < 2) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    applyRouteFit(map, routeCoordinates, reduceMotion);
    // routeCoordinates is fixed for a run; refit only for a new run or a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, live, routeId]);
}
