"use client";
import { useTranslation } from "@/components/language-provider";

import { addToStyle } from "@/components/map/style-guard";
import { useEffect } from "react";
import { Marker, type Map } from "maplibre-gl";

import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import { mapPalette } from "@/components/map/map-palette";
import { osmGhostFeatures } from "@/components/map/osm-ghost";
import type { ResolvedTheme } from "@/lib/theme-transition";

type OsmGhostMarkerProps = {
  map: Map | null;
  incident: MapEndpoint | null;
  styleRevision: number;
  theme: ResolvedTheme;
};

const SOURCE_ID = "greenwave-osm-ghost";
const LAYER_ID = "greenwave-osm-ghost-line";

/**
 * OSM's point of an incident address that disagrees with Kraków EMUiA: a muted pin and a dashed
 * line to the incident, so the spatial difference is visible. Routing uses the EMUiA point.
 */
export function OsmGhostMarker({ map, incident, styleRevision, theme }: OsmGhostMarkerProps) {
  const { t } = useTranslation();
  const lat = incident?.position.lat ?? null;
  const lng = incident?.position.lng ?? null;
  const osmLat = incident?.osmPosition?.lat ?? null;
  const osmLng = incident?.osmPosition?.lng ?? null;

  useEffect(() => {
    if (!map || lat === null || lng === null || osmLat === null || osmLng === null) return;
    const marker = new Marker({ element: createGhostPin(t), anchor: "center" })
      .setLngLat([osmLng, osmLat])
      .addTo(map);
    // Mid theme swap the style is still loading: skip, the next styleRevision re-adds.
    addToStyle(() => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: osmGhostFeatures({ lat, lng }, { lat: osmLat, lng: osmLng }),
      });
      map.addLayer({
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": mapPalette(theme).endpointLine,
          "line-width": 1.5,
          "line-dasharray": [1, 2],
          "line-opacity": 0.8,
        },
        layout: { "line-cap": "round" },
      });
    });
    return () => {
      marker.remove();
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map, lat, lng, osmLat, osmLng, styleRevision, theme, t]);

  return null;
}

function createGhostPin(t: (text: string) => string) {
  const element = document.createElement("div");
  element.className = "relative size-4 text-[11px] font-medium text-muted-foreground";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", t("OSM position"));

  const labelElement = document.createElement("span");
  labelElement.className =
    "absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap surface-glass rounded-full! px-2 py-0.5";
  labelElement.textContent = t("OSM position");

  const pin = document.createElement("span");
  pin.className = "map-dot map-dot--ghost";

  element.append(pin, labelElement);
  return element;
}
