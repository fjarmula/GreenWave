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

const MAP_STYLES: Record<"light" | "dark", string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const MAPLIBRE_WORKER_URL = new URL(
  "maplibre-gl/dist/maplibre-gl-worker.mjs",
  import.meta.url,
).toString();

const KRAKOW_CENTER: [number, number] = [19.945, 50.064];

type MapContainerProps = {
  live: boolean;
  origin: OriginEndpoint;
  destination: DestinationEndpoint;
  focusRequest: number;
};

export function MapContainer({ live, origin, destination, focusRequest }: MapContainerProps) {
  const { routeData, liveTelemetry, startRequest } = useSimulationState();
  const vehiclePosition = liveTelemetry?.ambulance.position ?? startRequest?.origin;
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    const instance = new maplibregl.Map({
      container: mapElement.current,
      style: MAP_STYLES[theme],
      center: KRAKOW_CENTER,
      zoom: 12.4,
      minZoom: 10,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.once("load", () => setMap(instance));
    mapRef.current = instance;

    return () => {
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, [theme]);

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
      />
      <EndpointMarkers
        map={map}
        origin={origin}
        destination={destination}
        focusRequest={focusRequest}
      />
      <RouteLayer map={map} routeGeometry={routeData?.route_geometry ?? null} />
      <SignalMarkers
        map={map}
        visible={live}
        routeGeometry={routeData?.route_geometry ?? null}
        intersections={liveTelemetry?.intersections ?? []}
      />
    </div>
  );
}
