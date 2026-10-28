"use client";

import { addToStyle } from "@/components/map/style-guard";
import { useEffect } from "react";
import type { Map } from "maplibre-gl";

import { mapPalette } from "@/components/map/map-palette";
import type { ResolvedTheme } from "@/lib/theme-transition";
import { VEHICLE_WAKE_LAYER } from "@/components/map/vehicle-wake";
import type { GreenWaveMode, RouteGeometry } from "@/types/telemetry";

type RouteLayerProps = {
  map: Map | null;
  routeGeometry: RouteGeometry | null;
  styleRevision: number;
  theme: ResolvedTheme;
  /** Green Wave draws the corridor in `go`; standard traffic a neutral line. */
  mode: GreenWaveMode;
};

/** White-cased road with the corridor line on top, as in the home animation. */
export function RouteLayer({ map, routeGeometry, styleRevision, theme, mode }: RouteLayerProps) {
  useEffect(() => {
    if (!map || !routeGeometry || routeGeometry.coordinates.length < 2) return;
    const palette = mapPalette(theme);

    const sourceId = "greenwave-route";
    const lineLayerId = "greenwave-route-line";
    const casingId = "greenwave-route-casing";
    // Mid theme swap the style is still loading: skip, the next styleRevision re-adds.
    addToStyle(() => {
      map.addSource(sourceId, {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: routeGeometry },
      });
      // Below the vehicle wake when it is already drawn, whichever re-adds first after a style load.
      const beforeId = map.getLayer(VEHICLE_WAKE_LAYER) ? VEHICLE_WAKE_LAYER : undefined;
      map.addLayer(
        {
          id: casingId,
          type: "line",
          source: sourceId,
          paint: { "line-color": palette.routeCasing, "line-width": 14 },
          layout: { "line-cap": "round", "line-join": "round" },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: lineLayerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": mode === "DISABLED" ? palette.routeStandard : palette.routeLive,
            "line-width": 7,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        },
        beforeId,
      );
    });
    return () => {
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getLayer(casingId)) map.removeLayer(casingId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, routeGeometry, styleRevision, theme, mode]);

  return null;
}
