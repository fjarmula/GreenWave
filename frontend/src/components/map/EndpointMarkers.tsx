"use client";

import { useEffect, useRef } from "react";
import type { Map } from "maplibre-gl";

import { applyEndpointFit } from "@/components/map/endpoint-fit";
import { mapPalette } from "@/components/map/map-palette";
import { snapConnectorFeatures, SNAP_CONNECTOR_MIN_METERS } from "@/components/map/snap-connectors";
import type { ResolvedTheme } from "@/lib/theme-transition";
import type { Position, SimulationStartRequest, SimulationStartResponse } from "@/types/telemetry";

/** A labelled map point: the dispatching station (origin) or the incident (destination). */
/** ``osmPosition``: an incident address whose OSM point disagrees with EMUiA (ADR 0013). */
export type MapEndpoint = { label: string; position: Position; osmPosition?: Position | null };

type EndpointMarkersProps = {
  map: Map | null;
  origin: MapEndpoint | null;
  destination: MapEndpoint | null;
  focusRequest: number;
  /** False once a route is shown: the map then fits the route instead of the endpoints. */
  fitToEndpoints: boolean;
  startRequest: SimulationStartRequest | null;
  routeData: SimulationStartResponse | null;
  styleRevision: number;
  theme: ResolvedTheme;
};

/**
 * Fits the map to the chosen station and the incident only when asked to or when one is
 * off screen (the user's zoom is kept otherwise), and draws the dashed snap
 * connectors once a run starts. The pins themselves are `StationLayer` (station)
 * and `IncidentMarker` (incident).
 */
export function EndpointMarkers({
  map,
  origin,
  destination,
  focusRequest,
  fitToEndpoints,
  startRequest,
  routeData,
  styleRevision,
  theme,
}: EndpointMarkersProps) {
  // Primitive dependencies: the dashboard builds new endpoint objects on every render.
  const originLng = origin?.position.lng ?? null;
  const originLat = origin?.position.lat ?? null;
  const destinationLng = destination?.position.lng ?? null;
  const destinationLat = destination?.position.lat ?? null;

  // A re-render or mode switch must not replay an old "View station and incident" request.
  const appliedFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (!map || !fitToEndpoints) return;
    const points: Array<[number, number]> = [];
    if (originLng !== null && originLat !== null) points.push([originLng, originLat]);
    if (destinationLng !== null && destinationLat !== null) {
      points.push([destinationLng, destinationLat]);
    }
    const focusRequested = focusRequest !== appliedFocusRequest.current;
    appliedFocusRequest.current = focusRequest;
    applyEndpointFit(map, {
      points,
      focusRequested,
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, [destinationLat, destinationLng, fitToEndpoints, focusRequest, map, originLat, originLng]);

  useEffect(() => {
    if (!map || !startRequest) return;
    const connectors = snapConnectorFeatures(startRequest, routeData, SNAP_CONNECTOR_MIN_METERS);
    if (!connectors.features.length) return;
    const sourceId = "greenwave-snap-connectors";
    const layerId = "greenwave-snap-connectors-line";
    const onFootLayerId = "greenwave-on-foot-line";
    map.addSource(sourceId, { type: "geojson", data: connectors });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      filter: ["!", ["get", "onFoot"]],
      paint: {
        "line-color": mapPalette(theme).endpointLine,
        "line-width": 2,
        "line-dasharray": [2, 2],
        "line-opacity": 0.9,
      },
      layout: { "line-cap": "round" },
    });
    // The walk to an off-road incident: dotted, in the beacon colour, not the snap dash.
    map.addLayer({
      id: onFootLayerId,
      type: "line",
      source: sourceId,
      filter: ["get", "onFoot"],
      paint: {
        "line-color": mapPalette(theme).onFootLine,
        "line-width": 2.5,
        "line-dasharray": [0.5, 2],
      },
      layout: { "line-cap": "round" },
    });
    return () => {
      if (map.getLayer(onFootLayerId)) map.removeLayer(onFootLayerId);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, routeData, startRequest, styleRevision, theme]);

  return null;
}
