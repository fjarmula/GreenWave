import { useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { canFit } from "@/components/map/endpoint-fit";
import type { SimulationStartResponse } from "@/types/telemetry";

const ROUTE_FIT_DURATION_MILLISECONDS = 600;
// The live HUD panels beside the map only exist from the `lg` breakpoint (1024 px).
const SIDE_PANELS_MIN_WIDTH_PIXELS = 1024;

/** Fits the whole route, leaving room for the live HUD panels beside the map. */
export function applyRouteFit(
  map: Map,
  routeCoordinates: ReadonlyArray<[lng: number, lat: number]>,
  reduceMotion: boolean,
): void {
  if (!canFit(map)) return;
  const bounds = new maplibregl.LngLatBounds(routeCoordinates[0], routeCoordinates[0]);
  routeCoordinates.forEach((coordinate) => bounds.extend(coordinate));
  const sidePanels = map.getContainer().clientWidth >= SIDE_PANELS_MIN_WIDTH_PIXELS;
  map.fitBounds(bounds, {
    padding: sidePanels
      ? { top: 160, right: 480, bottom: 120, left: 340 }
      : { top: 180, right: 60, bottom: 80, left: 40 },
    maxZoom: 16,
    duration: reduceMotion ? 0 : ROUTE_FIT_DURATION_MILLISECONDS,
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
