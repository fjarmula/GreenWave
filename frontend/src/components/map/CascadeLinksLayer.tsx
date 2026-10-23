"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Map } from "maplibre-gl";

import { mapPalette } from "@/components/map/map-palette";
import { cascadeLinkFeatures } from "@/lib/cascade-links";
import type { ResolvedTheme } from "@/lib/theme-transition";
import type { SimulationStartResponse } from "@/types/telemetry";

type CascadeLinksLayerProps = {
  route: SimulationStartResponse | null;
};

type CascadeLinksMapProviderProps = {
  map: Map | null;
  styleRevision: number;
  theme: ResolvedTheme;
  children: ReactNode;
};

const CascadeLinksMapContext = createContext<{
  map: Map | null;
  styleRevision: number;
  theme: ResolvedTheme;
} | null>(null);

export function CascadeLinksMapProvider({
  map,
  styleRevision,
  theme,
  children,
}: CascadeLinksMapProviderProps) {
  return (
    <CascadeLinksMapContext value={{ map, styleRevision, theme }}>
      {children}
    </CascadeLinksMapContext>
  );
}

export function CascadeLinksLayer({ route }: CascadeLinksLayerProps) {
  const context = useContext(CascadeLinksMapContext);
  const map = context?.map ?? null;
  const styleRevision = context?.styleRevision ?? 0;
  const theme = context?.theme ?? "light";
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
        "line-color": mapPalette(theme).cascade,
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
  }, [map, route, styleRevision, theme]);

  return null;
}
