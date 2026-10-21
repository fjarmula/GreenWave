"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Marker, type Map } from "maplibre-gl";

import { VehicleIcon } from "@/components/map/VehicleIcon";
import { VEHICLE_ICON_COLORS } from "@/components/map/vehicle-icons";
import { createMarkerSlide, type MarkerSlide } from "@/lib/marker-slide";
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
  /** Slide time to each new position: one tick's wall-clock interval, so it arrives with the next. */
  animationMilliseconds: number;
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
  animationMilliseconds,
}: VehicleMarkerProps) {
  const markerRef = useRef<Marker | null>(null);
  const slideRef = useRef<MarkerSlide<[number, number]> | null>(null);
  const routeRef = useRef(routeGeometry);
  const durationRef = useRef(animationMilliseconds);
  useEffect(() => {
    routeRef.current = routeGeometry;
    durationRef.current = animationMilliseconds;
  }, [routeGeometry, animationMilliseconds]);
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
    const slide = createMarkerSlide<[number, number]>({
      show: (point) => marker.setLngLat(point),
      interpolate: (from, to, progress) =>
        interpolateAlongRoute(routeRef.current, from, to, progress),
      now: () => performance.now(),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    });
    slideRef.current = slide;
    return () => {
      slide.cancel();
      marker.remove();
      markerRef.current = null;
      slideRef.current = null;
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
    const slide = slideRef.current;
    if (!map || !marker || !slide || longitude === undefined || latitude === undefined) return;
    const target: [number, number] = [longitude, latitude];
    const placing = !marker.getElement().isConnected;
    // One tick's slide, from the previous tick's position, over one tick's wall-clock interval;
    // a playback-speed change applies from the next tick without restarting this one.
    slide.moveTo(target, placing ? 0 : durationRef.current, {
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    if (placing) marker.addTo(map);
  }, [map, element, longitude, latitude]);

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
