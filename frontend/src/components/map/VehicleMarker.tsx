"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Marker, type Map } from "maplibre-gl";

import { VehicleIcon } from "@/components/map/VehicleIcon";
import { VEHICLE_ICON_COLORS } from "@/components/map/vehicle-icons";
import { interpolateAlongRoute } from "@/lib/route-position";
import type { RouteGeometry, VehicleType } from "@/types/telemetry";

type VehicleMarkerProps = {
  map: Map | null;
  coordinates: [number, number] | null;
  visible: boolean;
  vehicleType: VehicleType;
  /** Animate between positions along this polyline instead of a straight chord. */
  routeGeometry: RouteGeometry | null;
  /** No fresh telemetry (reconnecting, lost, ended with an error): dim the marker. */
  stale: boolean;
};

const VEHICLE_NAMES: Record<VehicleType, string> = {
  AMBULANCE: "ambulance",
  FIRE_TRUCK: "fire truck",
  POLICE_CAR: "police car",
};

export function VehicleMarker({
  map,
  coordinates,
  visible,
  vehicleType,
  routeGeometry,
  stale,
}: VehicleMarkerProps) {
  const markerRef = useRef<Marker | null>(null);
  // Created only in the browser (the map exists only there); the icon is portalled into it.
  const element = useMemo(() => {
    if (!map || !visible) return null;
    const node = document.createElement("div");
    node.setAttribute("role", "img");
    node.style.zIndex = "3";
    return node;
  }, [map, visible]);

  useEffect(() => {
    if (!map || !element) return;
    const marker = new Marker({ element, anchor: "center" });
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, element]);

  useEffect(() => {
    const element = markerRef.current?.getElement();
    if (!element) return;
    const name = VEHICLE_NAMES[vehicleType];
    element.style.opacity = stale ? "0.45" : "1";
    element.setAttribute(
      "aria-label",
      stale
        ? `Simulated ${name} position (last received, telemetry paused)`
        : `Simulated ${name} position`,
    );
  }, [map, visible, stale, vehicleType]);

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
  }, [map, element, longitude, latitude, routeGeometry]);

  if (!element) return null;
  return createPortal(
    <span
      className={`grid size-9 place-items-center rounded-full border-2 border-white shadow-[0_0_22px_rgba(6,182,212,0.7)] ${VEHICLE_ICON_COLORS[vehicleType]}`}
    >
      <VehicleIcon type={vehicleType} className="size-5" />
    </span>,
    element,
  );
}
