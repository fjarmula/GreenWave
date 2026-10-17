"use client";

import { useEffect, useRef } from "react";
import { Marker, type Map } from "maplibre-gl";

import { interpolateAlongRoute } from "@/lib/route-position";
import type { RouteGeometry } from "@/types/telemetry";

type AmbulanceMarkerProps = {
  map: Map | null;
  coordinates: [number, number] | null;
  visible: boolean;
  /** Animate between positions along this polyline instead of a straight chord. */
  routeGeometry: RouteGeometry | null;
  /** No fresh telemetry (reconnecting, lost, ended with an error): dim the marker. */
  stale: boolean;
};

export function AmbulanceMarker({
  map,
  coordinates,
  visible,
  routeGeometry,
  stale,
}: AmbulanceMarkerProps) {
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

  useEffect(() => {
    const element = markerRef.current?.getElement();
    if (!element) return;
    element.style.opacity = stale ? "0.45" : "1";
    element.setAttribute(
      "aria-label",
      stale
        ? "Simulated ambulance position (last received, telemetry paused)"
        : "Simulated ambulance position",
    );
  }, [map, visible, stale]);

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
    const current = marker.getLngLat();
    const from: [number, number] = [current.lng, current.lat];
    const started = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 1000);
      marker.setLngLat(interpolateAlongRoute(routeGeometry, from, target, progress));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [map, visible, longitude, latitude, routeGeometry]);

  return null;
}
