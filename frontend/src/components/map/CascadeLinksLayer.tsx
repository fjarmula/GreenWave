"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Map } from "maplibre-gl";

import { cascadeLinkFeatures } from "@/lib/cascade-links";
import type { SimulationStartResponse } from "@/types/telemetry";

type CascadeLinksLayerProps = {
  route: SimulationStartResponse | null;
};

type CascadeLinksMapProviderProps = {
  map: Map | null;
  styleRevision: number;
  children: ReactNode;
};

const CascadeLinksMapContext = createContext<{ map: Map | null; styleRevision: number } | null>(
  null,
);

export function CascadeLinksMapProvider({
  map,
  styleRevision,
  children,
}: CascadeLinksMapProviderProps) {
  return <CascadeLinksMapContext value={{ map, styleRevision }}>{children}</CascadeLinksMapContext>;
}

export function CascadeLinksLayer({ route }: CascadeLinksLayerProps) {
  const context = useContext(CascadeLinksMapContext);
  const map = context?.map ?? null;
  const styleRevision = context?.styleRevision ?? 0;
  useEffect(() => {
    if (!map || !route) return;
    const features = cascadeLinkFeatures(route);
    if (!features.features.length) return;

    const sourceId = "greenwave-cascade-links";
    const layerId = "greenwave-cascade-links-line";
    map.addSource(sourceId, { type: "geojson", data: features });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#8b5cf6",
        "line-width": 4,
        "line-dasharray": [1.5, 1.5],
        "line-opacity": 0.9,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });

    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, route, styleRevision]);

  return null;
}
