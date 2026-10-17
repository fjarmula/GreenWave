"use client";

import { useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";

import type { DestinationEndpoint, OriginEndpoint } from "@/components/map/dispatch-endpoints";
import { snapConnectorFeatures, SNAP_CONNECTOR_MIN_METERS } from "@/components/map/snap-connectors";
import type { SimulationStartRequest, SimulationStartResponse } from "@/types/telemetry";

type EndpointMarkersProps = {
  map: Map | null;
  origin: OriginEndpoint;
  destination: DestinationEndpoint;
  focusRequest: number;
  live: boolean;
  /** False once a route is shown: the map then fits the route instead of the endpoints. */
  fitToEndpoints: boolean;
  startRequest: SimulationStartRequest | null;
  routeData: SimulationStartResponse | null;
  styleRevision: number;
};

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
  useEffect(() => {
    if (!map) return;

    const originMarker = createEndpointMarker("Origin", origin.mapLabel, "cyan");
    const destinationMarker = createEndpointMarker("Destination", destination.mapLabel, "emerald");

    const originMapMarker = new maplibregl.Marker({ element: originMarker, anchor: "center" })
      .setLngLat(origin.coordinates)
      .addTo(map);
    const destinationMapMarker = new maplibregl.Marker({
      element: destinationMarker,
      anchor: "center",
    })
      .setLngLat(destination.coordinates)
      .addTo(map);

    if (!fitToEndpoints) {
      return () => {
        originMapMarker.remove();
        destinationMapMarker.remove();
      };
    }
    const bounds = new maplibregl.LngLatBounds(origin.coordinates, origin.coordinates);
    bounds.extend(destination.coordinates);
    const mobile = map.getContainer().clientWidth < 640;
    map.fitBounds(bounds, {
      padding: mobile
        ? { top: live ? 180 : 110, right: 100, bottom: 80, left: 40 }
        : { top: 140, right: 160, bottom: 140, left: 160 },
      maxZoom: 13.2,
      duration: focusRequest ? 600 : 0,
    });

    return () => {
      originMapMarker.remove();
      destinationMapMarker.remove();
    };
  }, [destination, fitToEndpoints, focusRequest, live, map, origin]);

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

function createEndpointMarker(
  role: "Origin" | "Destination",
  label: string,
  color: "cyan" | "emerald",
) {
  const element = document.createElement("div");
  element.className =
    "relative size-7 font-mono text-[10px] font-bold text-foreground drop-shadow-md";
  element.setAttribute("aria-label", `${role}: ${label}`);

  const labelElement = document.createElement("span");
  labelElement.className =
    "absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border/80 bg-card/95 px-2 py-1 shadow-lg backdrop-blur";
  labelElement.textContent = `${role === "Origin" ? "A" : "B"} · ${label}`;

  const pin = document.createElement("span");
  pin.className = `grid size-7 place-items-center rounded-full border-2 border-background shadow-lg ${
    color === "cyan" ? "bg-cyan-500" : "bg-emerald-500"
  }`;
  pin.innerHTML = `<span class="size-2 rounded-full bg-white"></span>`;

  element.append(pin, labelElement);
  return element;
}
