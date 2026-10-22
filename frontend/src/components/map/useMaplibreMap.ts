import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

const MAP_STYLES: Record<"light" | "dark", string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const MAPLIBRE_WORKER_URL = new URL(
  "maplibre-gl/dist/maplibre-gl-worker.mjs",
  import.meta.url,
).toString();

const KRAKOW_CENTER: [number, number] = [19.945, 50.064];
// Data attribution (architecture §5); the basemap's own OSM attribution is added by its style.
const DATA_ATTRIBUTION = [
  '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>',
  'Road network &amp; signals © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL)',
  "Street registry © City of Kraków (MSIP)",
  "All signal states are simulated",
];
const MAP_STYLE_FADE_OUT_MILLISECONDS = 220;

/**
 * Owns the MapLibre instance for one container: creates it once, swaps the basemap
 * style when the theme changes (faded unless reduced motion) and counts style loads so
 * layers can re-add themselves.
 */
export function useMaplibreMap(theme: "light" | "dark") {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const initialTheme = useRef<"light" | "dark">(theme);
  const appliedTheme = useRef<"light" | "dark" | null>(null);
  const styleSwapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [map, setMap] = useState<Map | null>(null);
  const [styleRevision, setStyleRevision] = useState(0);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    const instance = new maplibregl.Map({
      container: mapElement.current,
      style: MAP_STYLES[initialTheme.current],
      center: KRAKOW_CENTER,
      zoom: 12.4,
      minZoom: 10,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: false,
    });
    instance.addControl(
      new maplibregl.AttributionControl({ customAttribution: DATA_ATTRIBUTION }),
      "bottom-right",
    );

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const onStyleLoad = () => {
      setMap(instance);
      setStyleRevision((revision) => revision + 1);
      requestAnimationFrame(() => {
        instance.getCanvas().classList.remove("dashboard-map-canvas--switching");
      });
    };
    instance.on("style.load", onStyleLoad);
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(mapElement.current);
    mapRef.current = instance;
    appliedTheme.current = initialTheme.current;

    return () => {
      resize.disconnect();
      instance.off("style.load", onStyleLoad);
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;

    if (styleSwapTimer.current) clearTimeout(styleSwapTimer.current);

    if (appliedTheme.current === theme) {
      instance.getCanvas().classList.remove("dashboard-map-canvas--switching");
      return;
    }

    const canvas = instance.getCanvas();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      appliedTheme.current = theme;
      instance.setStyle(MAP_STYLES[theme]);
      return;
    }

    canvas.classList.add("dashboard-map-canvas--switching");
    styleSwapTimer.current = setTimeout(() => {
      styleSwapTimer.current = null;
      if (mapRef.current !== instance) return;
      appliedTheme.current = theme;
      instance.setStyle(MAP_STYLES[theme]);
    }, MAP_STYLE_FADE_OUT_MILLISECONDS);

    return () => {
      if (styleSwapTimer.current) clearTimeout(styleSwapTimer.current);
      styleSwapTimer.current = null;
    };
  }, [theme]);

  return { mapElement, map, styleRevision };
}
