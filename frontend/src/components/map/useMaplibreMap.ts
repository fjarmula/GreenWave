import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { collapseCompactAttribution } from "@/components/map/attribution";
import { createBasemapLoader, groundOnlyStyle } from "@/components/map/basemap-style";
import { cartoRequestUrl } from "@/components/map/carto";
import { createMapThemeSwap } from "@/components/map/map-theme-swap";
import { registerThemeBarrier, type ResolvedTheme } from "@/lib/theme-transition";

const MAP_STYLES: Record<ResolvedTheme, string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const MAPLIBRE_WORKER_URL = new URL(
  "maplibre-gl/dist/maplibre-gl-worker.mjs",
  import.meta.url,
).toString();

const KRAKOW_CENTER: [number, number] = [19.945, 50.064];
// Data attribution (architecture §5); the basemap's own OSM attribution is added by its style.
// The simulation disclaimer lives in the always-visible provenance chip, not here.
export const DATA_ATTRIBUTION = [
  '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>',
  'Basemap © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
  'Road network &amp; signals © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL)',
  "Street registry © City of Kraków (MSIP)",
];

/**
 * Owns the MapLibre instance for one container: creates it once, swaps the basemap
 * style inside the theme view transition (a registered barrier) and counts style loads
 * so layers can re-add themselves.
 */
export function useMaplibreMap(theme: ResolvedTheme) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const initialTheme = useRef<ResolvedTheme>(theme);
  const swapRef = useRef<ReturnType<typeof createMapThemeSwap> | null>(null);
  const [map, setMap] = useState<Map | null>(null);
  const [styleRevision, setStyleRevision] = useState(0);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    const apiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim() ?? "";
    const styles = {
      light: cartoRequestUrl(MAP_STYLES.light, apiKey),
      dark: cartoRequestUrl(MAP_STYLES.dark, apiKey),
    };
    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    const instance = new maplibregl.Map({
      container: mapElement.current,
      // The plain ground until the recoloured basemap arrives (below).
      style: groundOnlyStyle(initialTheme.current),
      center: KRAKOW_CENTER,
      zoom: 12.4,
      minZoom: 10,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: false,
      transformRequest: (url) => ({ url: cartoRequestUrl(url, apiKey) }),
    });
    instance.addControl(
      new maplibregl.AttributionControl({ customAttribution: DATA_ATTRIBUTION }),
      "bottom-right",
    );

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const setStyle = createBasemapLoader(instance);
    const swap = createMapThemeSwap(
      {
        setStyle,
        onceStyleLoad: (callback) => instance.once("style.load", callback),
        tilesReady: () => instance.areTilesLoaded(),
        paint: () => instance.redraw(),
      },
      styles,
      initialTheme.current,
    );
    swapRef.current = swap;
    // Every basemap, the first one included, goes through the same recolouring path.
    setStyle(styles[initialTheme.current], initialTheme.current);
    const unregisterBarrier = registerThemeBarrier((next) => swap.to(next));
    const container = mapElement.current;
    let prefetched = false;
    const onStyleLoad = () => {
      setMap(instance);
      setStyleRevision((revision) => revision + 1);
      container.dataset.mapTheme = swap.applied();
      if (prefetched) return;
      prefetched = true;
      // Warm the other style so a theme switch waits on tiles, not on the network.
      const other = swap.applied() === "dark" ? "light" : "dark";
      void fetch(styles[other], { cache: "force-cache" }).catch(() => undefined);
    };
    instance.on("style.load", onStyleLoad);
    instance.once("load", () => collapseCompactAttribution(container));
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container);
    mapRef.current = instance;

    return () => {
      unregisterBarrier();
      swap.dispose();
      swapRef.current = null;
      resize.disconnect();
      instance.off("style.load", onStyleLoad);
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  // Theme changes outside the toggle (OS setting, another tab) swap here; a toggle switch has
  // already swapped inside its view transition, so this is a no-op then.
  useEffect(() => {
    void swapRef.current?.to(theme);
  }, [theme]);

  return { mapElement, map, styleRevision };
}
