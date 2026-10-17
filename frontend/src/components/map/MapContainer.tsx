"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { AmbulanceMarker } from "@/components/map/AmbulanceMarker";
import { EndpointMarkers } from "@/components/map/EndpointMarkers";
import { RouteLayer } from "@/components/map/RouteLayer";
import { SignalMarkers } from "@/components/map/SignalMarkers";
import type { DestinationEndpoint, OriginEndpoint } from "@/components/map/dispatch-endpoints";
import { useSimulationState } from "@/components/simulation-provider";
import { isTelemetryStale } from "@/lib/simulation-state";
import type { IntersectionTelemetry, RouteIntersection } from "@/types/telemetry";

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
const ROUTE_FIT_DURATION_MILLISECONDS = 600;
// The live HUD panels beside the map only exist from the `lg` breakpoint (1024 px).
const SIDE_PANELS_MIN_WIDTH_PIXELS = 1024;
// Stable empty lists so marker effects do not re-run on every render without a route.
const NO_ROUTE_INTERSECTIONS: RouteIntersection[] = [];
const NO_INTERSECTIONS: IntersectionTelemetry[] = [];
const MAP_STYLE_FADE_OUT_MILLISECONDS = 220;

type MapContainerProps = {
  live: boolean;
  origin: OriginEndpoint;
  destination: DestinationEndpoint;
  focusRequest: number;
};

export function MapContainer({ live, origin, destination, focusRequest }: MapContainerProps) {
  const { routeData, liveTelemetry, startRequest, simulationState, connection } =
    useSimulationState();
  const vehiclePosition = liveTelemetry?.ambulance.position ?? startRequest?.origin;
  const telemetryStale = isTelemetryStale({ simulationState, connection });
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
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
    mapRef.current = instance;
    appliedTheme.current = initialTheme.current;

    return () => {
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

  // Fit the whole route once per run (and once the live map exists); no animated fly with
  // reduced motion.
  const routeId = routeData?.simulation_id;
  const routeCoordinates = routeData?.route_geometry.coordinates;
  useEffect(() => {
    if (!map || !live || !routeCoordinates || routeCoordinates.length < 2) return;
    const bounds = new maplibregl.LngLatBounds(routeCoordinates[0], routeCoordinates[0]);
    routeCoordinates.forEach((coordinate) => bounds.extend(coordinate));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sidePanels = map.getContainer().clientWidth >= SIDE_PANELS_MIN_WIDTH_PIXELS;
    map.fitBounds(bounds, {
      padding: sidePanels
        ? { top: 160, right: 480, bottom: 120, left: 340 }
        : { top: 180, right: 60, bottom: 80, left: 40 },
      maxZoom: 16,
      duration: reduceMotion ? 0 : ROUTE_FIT_DURATION_MILLISECONDS,
    });
    // routeCoordinates is fixed for a run; refit only for a new run or a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, live, routeId]);

  return (
    <div
      ref={mapElement}
      className="!absolute inset-0 h-full w-full overflow-hidden"
      aria-label="MapLibre map"
    >
      {!map && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--map-surface)]">
          <span className="rounded-full border border-border/80 bg-card/80 px-3 py-1.5 font-mono text-[10px] text-muted-foreground shadow-lg backdrop-blur">
            Loading map tiles…
          </span>
        </div>
      )}
      <AmbulanceMarker
        map={map}
        visible={live && !!vehiclePosition}
        coordinates={vehiclePosition ? [vehiclePosition.lng, vehiclePosition.lat] : null}
        routeGeometry={routeData?.route_geometry ?? null}
        stale={telemetryStale}
      />
      <EndpointMarkers
        map={map}
        origin={origin}
        destination={destination}
        focusRequest={focusRequest}
        live={live}
        fitToEndpoints={!(live && routeData)}
        startRequest={startRequest}
        routeData={routeData}
        styleRevision={styleRevision}
      />
      <RouteLayer
        map={map}
        routeGeometry={routeData?.route_geometry ?? null}
        styleRevision={styleRevision}
      />
      <SignalMarkers
        map={map}
        visible={live}
        routeIntersections={routeData?.route_intersections ?? NO_ROUTE_INTERSECTIONS}
        intersections={liveTelemetry?.intersections ?? NO_INTERSECTIONS}
      />
    </div>
  );
}
