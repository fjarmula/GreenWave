"use client";

import { useEffect } from "react";
import type { GeoJSONSource, Map } from "maplibre-gl";
import type { Feature, LineString } from "geojson";

type RouteLayerProps = {
  map: Map | null;
  routeGeometry?: Feature<LineString>;
};

export function RouteLayer({ map, routeGeometry }: RouteLayerProps) {
  useEffect(() => {
    if (!map || !routeGeometry) return;

    const sourceId = "greenwave-route";
    const lineLayerId = "greenwave-route-line";
    map.addSource(sourceId, { type: "geojson", data: routeGeometry });
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
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, routeGeometry]);

  return null;
}

export type RouteSource = GeoJSONSource;
