"use client";

import { useEffect } from "react";
import type { Map } from "maplibre-gl";

import { mapPalette } from "@/components/map/map-palette";
import type { ResolvedTheme } from "@/lib/theme-transition";
import type { RouteGeometry } from "@/types/telemetry";

type RouteLayerProps = {
  map: Map | null;
  routeGeometry: RouteGeometry | null;
  styleRevision: number;
  theme: ResolvedTheme;
};

export function RouteLayer({ map, routeGeometry, styleRevision, theme }: RouteLayerProps) {
  useEffect(() => {
    if (!map || !routeGeometry || routeGeometry.coordinates.length < 2) return;
    const palette = mapPalette(theme);

    const sourceId = "greenwave-route";
    const lineLayerId = "greenwave-route-line";
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: routeGeometry },
    });
    const casingId = "greenwave-route-casing";
    map.addLayer({
      id: casingId,
      type: "line",
      source: sourceId,
      paint: { "line-color": palette.routeCasing, "line-width": 9, "line-opacity": 0.85 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: lineLayerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": palette.routeLive,
        "line-width": 5,
        "line-opacity": 0.9,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });

    return () => {
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getLayer(casingId)) map.removeLayer(casingId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, routeGeometry, styleRevision, theme]);

  return null;
}
