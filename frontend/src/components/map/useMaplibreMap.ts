import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import {
  attributionOptions,
  collapseCompactAttribution,
  peekAttributionOnHover,
} from "@/components/map/attribution";
import { createBasemapLoader, groundOnlyStyle } from "@/components/map/basemap-style";
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
export { DATA_ATTRIBUTION } from "@/components/map/attribution";

/**
 * Owns the MapLibre instance for one container: creates it once, swaps the basemap
 * style inside the theme view transition (a registered barrier) and counts style loads
 * so layers can re-add themselves.
 */
export function useMaplibreMap(
  theme: ResolvedTheme,
  {
    interactive = true,
    controls = true,
  }: {
    /** False: a backdrop map that ignores pointer and keyboard input. */
    interactive?: boolean;
    /** False: no zoom buttons (attribution is always shown). */
    controls?: boolean;
  } = {},
) {
  const mapElement = useRef<HTMLDivElement>(null);
  // Read once: the map is created a single time per container.
  const options = useRef({ interactive, controls });
  const mapRef = useRef<Map | null>(null);
  const initialTheme = useRef<ResolvedTheme>(theme);
  const swapRef = useRef<ReturnType<typeof createMapThemeSwap> | null>(null);
  const [map, setMap] = useState<Map | null>(null);
  const [styleRevision, setStyleRevision] = useState(0);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

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
      interactive: options.current.interactive,
    });
    instance.addControl(new maplibregl.AttributionControl(attributionOptions()), "bottom-right");
    if (options.current.controls)
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const setStyle = createBasemapLoader(instance);
    const swap = createMapThemeSwap(
      {
        setStyle,
        onceStyleLoad: (callback) => instance.once("style.load", callback),
        tilesReady: () => instance.areTilesLoaded(),
        paint: () => instance.redraw(),
      },
      MAP_STYLES,
      initialTheme.current,
    );
    swapRef.current = swap;
    // Every basemap, the first one included, goes through the same recolouring path.
    setStyle(MAP_STYLES[initialTheme.current], initialTheme.current);
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
      void fetch(MAP_STYLES[other], { cache: "force-cache" }).catch(() => undefined);
    };
    instance.on("style.load", onStyleLoad);
    instance.once("load", () => collapseCompactAttribution(container));
    const stopPeek = peekAttributionOnHover(container);
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container);
    mapRef.current = instance;

    return () => {
      unregisterBarrier();
      stopPeek();
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
