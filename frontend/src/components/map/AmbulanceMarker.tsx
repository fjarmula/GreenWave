"use client";

import { useEffect, useRef } from "react";
import { Marker, type Map } from "maplibre-gl";

type AmbulanceMarkerProps = {
  map: Map | null;
  coordinates?: [number, number];
  visible?: boolean;
};

const DEFAULT_COORDINATES: [number, number] = [19.945, 50.064];

export function AmbulanceMarker({
  map,
  coordinates = DEFAULT_COORDINATES,
  visible = false,
}: AmbulanceMarkerProps) {
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!map || !visible) return;

    const element = document.createElement("div");
    element.className =
      "grid size-9 place-items-center rounded-full border-2 border-cyan-300 bg-slate-950 text-cyan-100 shadow-[0_0_22px_rgba(6,182,212,0.7)]";
    element.setAttribute("aria-label", "Simulated ambulance position");
    element.innerHTML = `<span aria-hidden="true">🚑</span>`;

    const marker = new Marker({ element, anchor: "center" }).setLngLat(coordinates).addTo(map);
    markerRef.current = marker;

    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [coordinates, map, visible]);

  return null;
}
