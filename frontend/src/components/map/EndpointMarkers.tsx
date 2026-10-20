"use client";

import { useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import { snapConnectorFeatures, SNAP_CONNECTOR_MIN_METERS } from "@/components/map/snap-connectors";
import type { Position, SimulationStartRequest, SimulationStartResponse } from "@/types/telemetry";

/** A labelled map point: the dispatching station (origin) or the incident (destination). */
export type MapEndpoint = { label: string; position: Position };

type EndpointMarkersProps = {
  map: Map | null;
  origin: MapEndpoint | null;
  destination: MapEndpoint | null;
  focusRequest: number;
  live: boolean;
  /** False once a route is shown: the map then fits the route instead of the endpoints. */
  fitToEndpoints: boolean;
  startRequest: SimulationStartRequest | null;
  routeData: SimulationStartResponse | null;
  styleRevision: number;
};

/**
 * Fits the map to the chosen station and the incident, and draws the dashed snap
 * connectors once a run starts. The pins themselves are `StationLayer` (station)
 * and `IncidentMarker` (incident).
 */
export function EndpointMarkers({
  map,
  origin,
  destination,
  focusRequest,
  live,
  fitToEndpoints,
  startRequest,
  routeData,
  styleRevision,
}: EndpointMarkersProps) {
  // Primitive dependencies: the dashboard builds new endpoint objects on every render.
  const originLng = origin?.position.lng ?? null;
  const originLat = origin?.position.lat ?? null;
  const destinationLng = destination?.position.lng ?? null;
  const destinationLat = destination?.position.lat ?? null;

  useEffect(() => {
    if (!map || !fitToEndpoints) return;
    const points: Array<[number, number]> = [];
    if (originLng !== null && originLat !== null) points.push([originLng, originLat]);
    if (destinationLng !== null && destinationLat !== null) {
      points.push([destinationLng, destinationLat]);
    }
    if (points.length === 0) return;
    const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
    points.forEach((point) => bounds.extend(point));
    const mobile = map.getContainer().clientWidth < 640;
    map.fitBounds(bounds, {
      padding: mobile
        ? { top: live ? 180 : 110, right: 100, bottom: 80, left: 40 }
        : { top: 140, right: 160, bottom: 140, left: 160 },
      maxZoom: points.length > 1 ? 13.2 : 14,
      duration: focusRequest ? 600 : 0,
    });
  }, [
    destinationLat,
    destinationLng,
    fitToEndpoints,
    focusRequest,
    live,
    map,
    originLat,
    originLng,
  ]);

  useEffect(() => {
    if (!map || !startRequest) return;
    const connectors = snapConnectorFeatures(startRequest, routeData, SNAP_CONNECTOR_MIN_METERS);
    if (!connectors.features.length) return;
    const sourceId = "greenwave-snap-connectors";
    const layerId = "greenwave-snap-connectors-line";
    map.addSource(sourceId, { type: "geojson", data: connectors });
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#64748b",
        "line-width": 2,
        "line-dasharray": [2, 2],
        "line-opacity": 0.9,
      },
      layout: { "line-cap": "round" },
    });
    return () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, routeData, startRequest, styleRevision]);

  return null;
}
