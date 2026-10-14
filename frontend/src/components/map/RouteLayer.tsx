"use client";

import { useEffect } from "react";
import type { Map } from "maplibre-gl";
import type { RouteGeometry } from "@/types/telemetry";

type RouteLayerProps = {
  map: Map | null;
  routeGeometry: RouteGeometry | null;
};

export function RouteLayer({ map, routeGeometry }: RouteLayerProps) {
  useEffect(() => {
    if (!map || !routeGeometry || routeGeometry.coordinates.length < 2) return;

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
      paint: { "line-color": "#064e3b", "line-width": 9, "line-opacity": 0.85 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: lineLayerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#10b981",
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
  }, [map, routeGeometry]);

  return null;
}
