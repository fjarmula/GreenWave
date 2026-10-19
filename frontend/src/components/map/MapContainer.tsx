"use client";

import { useTheme } from "next-themes";

import { AmbulanceMarker } from "@/components/map/AmbulanceMarker";
import { CascadeLinksLayer, CascadeLinksMapProvider } from "@/components/map/CascadeLinksLayer";
import { EndpointMarkers } from "@/components/map/EndpointMarkers";
import { RouteLayer } from "@/components/map/RouteLayer";
import { SignalMarkers } from "@/components/map/SignalMarkers";
import { useMaplibreMap } from "@/components/map/useMaplibreMap";
import { useRouteFit } from "@/components/map/useRouteFit";
import type { DestinationEndpoint, OriginEndpoint } from "@/components/map/dispatch-endpoints";
import { useSimulationState } from "@/components/simulation-provider";
import { isTelemetryStale } from "@/lib/simulation-state";
import type { IntersectionTelemetry, RouteIntersection } from "@/types/telemetry";

// Stable empty lists so marker effects do not re-run on every render without a route.
const NO_ROUTE_INTERSECTIONS: RouteIntersection[] = [];
const NO_INTERSECTIONS: IntersectionTelemetry[] = [];

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
  const { mapElement, map, styleRevision } = useMaplibreMap(theme);
  useRouteFit(map, live, routeData);

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
      <CascadeLinksMapProvider map={map} styleRevision={styleRevision}>
        <CascadeLinksLayer route={routeData} />
      </CascadeLinksMapProvider>
      <SignalMarkers
        map={map}
        visible={live}
        routeIntersections={routeData?.route_intersections ?? NO_ROUTE_INTERSECTIONS}
        intersections={liveTelemetry?.intersections ?? NO_INTERSECTIONS}
      />
    </div>
  );
}
