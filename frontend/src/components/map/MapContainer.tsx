"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import { LocateFixed, Route } from "lucide-react";

import { CascadeLinksLayer, CascadeLinksMapProvider } from "@/components/map/CascadeLinksLayer";
import { EndpointMarkers, type MapEndpoint } from "@/components/map/EndpointMarkers";
import { IncidentMarker } from "@/components/map/IncidentMarker";
import { RouteLayer } from "@/components/map/RouteLayer";
import { SignalMarkers } from "@/components/map/SignalMarkers";
import { StationLayer } from "@/components/map/StationLayer";
import { useMaplibreMap } from "@/components/map/useMaplibreMap";
import { useMapCamera } from "@/components/map/useMapCamera";
import { useFollowTarget } from "@/components/map/follow-context";
import { useVehicleWake } from "@/components/map/useVehicleWake";
import { VehicleMarker } from "@/components/map/VehicleMarker";
import { tickIntervalMilliseconds } from "@/lib/playback-speed";
import { useSimulationState } from "@/components/simulation-provider";
import type { SimulationState } from "@/lib/simulation-state";
import { selectMapState } from "@/lib/map-render-state";
import { isTelemetryStale } from "@/lib/simulation-state";
import type {
  IntersectionTelemetry,
  Position,
  RouteIntersection,
  SignalPhaseIndicator,
  Station,
  VehicleType,
} from "@/types/telemetry";

// Stable empty lists so marker effects do not re-run on every render without a route.
const NO_ROUTE_INTERSECTIONS: RouteIntersection[] = [];
const NO_INTERSECTIONS: IntersectionTelemetry[] = [];
const NO_SIGNAL_PHASES: SignalPhaseIndicator[] = [];

type MapContainerProps = {
  live: boolean;
  snapshot?: SimulationState;
  origin: MapEndpoint | null;
  destination: MapEndpoint | null;
  focusRequest: number;
  stations: Station[];
  selectedVehicleType: VehicleType;
  chosenStationId: string | null;
  runnerUpIds: string[];
  /** Setup only: a click picks the incident. Ignored while a run is live. */
  onMapClick: (position: Position) => void;
  /** Called when the user pans, zooms or rotates the setup map by hand. */
  onUserMove?: () => void;
  /** Driver mode labels only the next junctions, by street; other workspaces label every one. */
  signalLabels?: "full" | "driver";
};

export function MapContainer({
  live,
  snapshot,
  origin,
  destination,
  focusRequest,
  stations,
  selectedVehicleType,
  chosenStationId,
  runnerUpIds,
  onMapClick,
  onUserMove,
  signalLabels = "full",
}: MapContainerProps) {
  const liveState = useSimulationState();
  const { routeData, liveTelemetry, startRequest, simulationState, connection } = selectMapState(
    snapshot ?? liveState,
    live,
  );
  const vehiclePosition = liveTelemetry?.ambulance.position ?? startRequest?.origin;
  const telemetryStale = isTelemetryStale({ simulationState, connection });
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const { mapElement, map, styleRevision } = useMaplibreMap(theme);
  const canFollow = live && simulationState === "RUNNING" && !telemetryStale && !!vehiclePosition;
  const camera = useMapCamera(
    map,
    live ? routeData : null,
    canFollow,
    startRequest?.destination ?? null,
  );
  const showWake = useVehicleWake(
    map,
    routeData?.route_geometry ?? null,
    live && routeData?.green_wave_mode !== "DISABLED",
    styleRevision,
    theme,
  );
  const { display, mode: cameraMode, resume, showRoute } = camera;
  const followable = canFollow && !!routeData;
  useFollowTarget(
    useMemo(
      () => (followable ? { following: cameraMode === "following", resume, showRoute } : null),
      [followable, cameraMode, resume, showRoute],
    ),
  );
  const displayVehicle = useCallback(
    (position: [number, number]) => {
      display(position);
      showWake(position);
    },
    [display, showWake],
  );

  useEffect(() => {
    if (!map || live || !onUserMove) return;
    // Programmatic camera moves (fits, focus requests) carry no originalEvent.
    const moved = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) onUserMove();
    };
    map.on("dragstart", moved);
    map.on("zoomstart", moved);
    map.on("rotatestart", moved);
    return () => {
      map.off("dragstart", moved);
      map.off("zoomstart", moved);
      map.off("rotatestart", moved);
    };
  }, [live, map, onUserMove]);

  useEffect(() => {
    if (!map || live) return;
    const canvas = map.getCanvas();
    const pick = (event: { lngLat: { lat: number; lng: number } }) =>
      onMapClick({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    map.on("click", pick);
    canvas.style.cursor = "crosshair";
    return () => {
      map.off("click", pick);
      canvas.style.cursor = "";
    };
  }, [live, map, onMapClick]);

  return (
    <>
      <div
        ref={mapElement}
        className="dashboard-map !absolute inset-0 h-full w-full overflow-hidden"
        aria-label="MapLibre map"
      >
        {!map && (
          <div className="absolute inset-0 grid place-items-center bg-[var(--map-surface)]">
            <span className="surface-glass rounded-full! px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
              Loading map tiles…
            </span>
          </div>
        )}
        <StationLayer
          map={map}
          stations={stations}
          selectedType={startRequest && live ? startRequest.vehicle_type : selectedVehicleType}
          chosenId={chosenStationId}
          runnerUpIds={live ? [] : runnerUpIds}
        />
        <IncidentMarker map={map} incident={destination} />
        <VehicleMarker
          map={map}
          visible={live && !!vehiclePosition}
          vehicleType={startRequest?.vehicle_type ?? selectedVehicleType}
          coordinates={vehiclePosition ? [vehiclePosition.lng, vehiclePosition.lat] : null}
          routeGeometry={routeData?.route_geometry ?? null}
          stale={telemetryStale}
          ended={simulationState !== "RUNNING"}
          onDisplayedPosition={displayVehicle}
          animationMilliseconds={tickIntervalMilliseconds(startRequest?.playback_speed ?? 1)}
        />
        <EndpointMarkers
          map={map}
          origin={origin}
          destination={destination}
          focusRequest={focusRequest}
          fitToEndpoints={!(live && routeData)}
          startRequest={startRequest}
          routeData={routeData}
          styleRevision={styleRevision}
          theme={theme}
        />
        <RouteLayer
          map={map}
          routeGeometry={routeData?.route_geometry ?? null}
          styleRevision={styleRevision}
          theme={theme}
          mode={routeData?.green_wave_mode ?? "ENABLED"}
        />
        <CascadeLinksMapProvider map={map} styleRevision={styleRevision} theme={theme}>
          <CascadeLinksLayer route={routeData} />
        </CascadeLinksMapProvider>
        <SignalMarkers
          map={map}
          visible={live}
          routeIntersections={routeData?.route_intersections ?? NO_ROUTE_INTERSECTIONS}
          intersections={liveTelemetry?.intersections ?? NO_INTERSECTIONS}
          phases={liveTelemetry?.signal_phases ?? NO_SIGNAL_PHASES}
          theme={theme}
          labels={signalLabels}
        />
      </div>
      {live && routeData && (
        <div
          className="workspace-camera-controls absolute top-3 left-3 z-20 flex flex-wrap gap-2"
          data-map-occluder
        >
          <button className="workspace-button workspace-float" onClick={camera.showRoute}>
            <Route aria-hidden />
            Show route
          </button>
          <button
            className="workspace-button workspace-float"
            data-active={(canFollow && camera.mode === "following") || undefined}
            aria-pressed={canFollow && camera.mode === "following"}
            disabled={!canFollow}
            onClick={camera.resume}
          >
            <LocateFixed aria-hidden />
            {canFollow && camera.mode === "following" ? "Following vehicle" : "Follow vehicle"}
          </button>
        </div>
      )}
    </>
  );
}
