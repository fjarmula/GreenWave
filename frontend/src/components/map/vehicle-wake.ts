import type { GeoJSONSource, Map } from "maplibre-gl";

import type { MapPalette } from "@/components/map/map-palette";
import { distanceAlongRoute, routeSlice } from "@/lib/route-position";
import type { RouteGeometry } from "@/types/telemetry";

export const VEHICLE_WAKE_LAYER = "vehicle-wake";
const VEHICLE_WAKE_SOURCE = "vehicle-wake";
/** How much route the green wake trails behind the vehicle. */
const WAKE_METERS = 120;

type WakeMap = Pick<Map, "addSource" | "addLayer" | "getLayer" | "removeLayer" | "removeSource"> & {
  getSource(id: string): unknown;
};

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The green wake behind the vehicle in Green Wave runs (the home animation's language): the last
 * 120 m of route, fading from transparent to the wake colour at the vehicle. `line-gradient`
 * needs a source with line metrics.
 */
export function attachVehicleWake(map: WakeMap, palette: MapPalette) {
  map.addSource(VEHICLE_WAKE_SOURCE, {
    type: "geojson",
    lineMetrics: true,
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: VEHICLE_WAKE_LAYER,
    type: "line",
    source: VEHICLE_WAKE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      // Wider than the 7px corridor line it covers, so it reads as a band, not the same line.
      "line-width": 12,
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        withAlpha(palette.wake, 0),
        1,
        withAlpha(palette.wake, 0.7),
      ],
    },
  });
  return {
    show(route: RouteGeometry, position: [number, number]) {
      const along = distanceAlongRoute(route, position);
      const coordinates = along === null ? null : routeSlice(route, along - WAKE_METERS, along);
      if (!coordinates || coordinates.length < 2) return;
      (map.getSource(VEHICLE_WAKE_SOURCE) as GeoJSONSource | undefined)?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      });
    },
    remove() {
      if (map.getLayer(VEHICLE_WAKE_LAYER)) map.removeLayer(VEHICLE_WAKE_LAYER);
      if (map.getSource(VEHICLE_WAKE_SOURCE)) map.removeSource(VEHICLE_WAKE_SOURCE);
    },
  };
}
