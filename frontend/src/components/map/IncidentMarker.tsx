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
  element.className = "relative size-7 font-mono text-[10px] font-bold text-foreground";
  element.setAttribute("aria-label", `Incident: ${label}`);
  element.style.zIndex = "2";

  const labelElement = document.createElement("span");
  labelElement.className =
    "absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border surface-float px-2 py-1";
  labelElement.textContent = `Incident · ${label}`;

  const pin = document.createElement("span");
  pin.className =
    "grid size-7 place-items-center rounded-full border-2 border-background bg-emergency shadow-marker";
  pin.innerHTML = `<span class="size-2 rounded-full bg-white"></span>`;

  element.append(pin, labelElement);
  return element;
}
