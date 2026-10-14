"use client";

import { useEffect, useRef } from "react";
import { Marker, type Map } from "maplibre-gl";

type AmbulanceMarkerProps = {
  map: Map | null;
  coordinates: [number, number] | null;
  visible: boolean;
};

export function AmbulanceMarker({ map, coordinates, visible }: AmbulanceMarkerProps) {
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!map || !visible) return;

    const element = document.createElement("div");
    element.className =
      "grid size-9 place-items-center rounded-full border-2 border-cyan-300 bg-slate-950 text-cyan-100 shadow-[0_0_22px_rgba(6,182,212,0.7)]";
    element.setAttribute("aria-label", "Simulated ambulance position");
    element.style.zIndex = "3";
    element.innerHTML = `<span aria-hidden="true">🚑</span>`;

    const marker = new Marker({ element, anchor: "center" });
    markerRef.current = marker;

    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, visible]);

  const longitude = coordinates?.[0];
  const latitude = coordinates?.[1];
  useEffect(() => {
    const marker = markerRef.current;
    if (!map || !marker || longitude === undefined || latitude === undefined) return;
    const target: [number, number] = [longitude, latitude];
    if (!marker.getElement().isConnected) {
      marker.setLngLat(target).addTo(map);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      marker.setLngLat(target);
      return;
    }
    const from = marker.getLngLat();
    const started = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 1000);
      marker.setLngLat([
        from.lng + (longitude - from.lng) * progress,
        from.lat + (latitude - from.lat) * progress,
      ]);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [map, visible, longitude, latitude]);

  return null;
}
