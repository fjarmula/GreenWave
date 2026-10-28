"use client";

import { useEffect } from "react";
import { Marker, type Map } from "maplibre-gl";

import type { MapEndpoint } from "@/components/map/EndpointMarkers";

type IncidentMarkerProps = { map: Map | null; incident: MapEndpoint | null };

/** The incident pin, where the run ends. */
export function IncidentMarker({ map, incident }: IncidentMarkerProps) {
  const label = incident?.label ?? null;
  const lng = incident?.position.lng ?? null;
  const lat = incident?.position.lat ?? null;

  useEffect(() => {
    if (!map || label === null || lng === null || lat === null) return;
    const marker = new Marker({ element: createIncidentPin(label), anchor: "center" })
      .setLngLat([lng, lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, label, lng, lat]);

  return null;
}

function createIncidentPin(label: string) {
  const element = document.createElement("div");
  element.className = "relative size-5 text-[11px] font-semibold text-foreground";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `Incident: ${label}`);
  element.style.zIndex = "2";

  const labelElement = document.createElement("span");
  labelElement.className =
    "absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap surface-glass rounded-full! px-2.5 py-1";
  labelElement.textContent = `Incident · ${label}`;

  const pin = document.createElement("span");
  pin.className = "map-dot map-dot--incident";

  element.append(pin, labelElement);
  return element;
}
