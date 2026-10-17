"use client";

import { useEffect, useRef } from "react";
import { Marker, type Map } from "maplibre-gl";
import { positionOnRoute } from "@/lib/route-position";
import type { IntersectionState, IntersectionTelemetry, RouteGeometry } from "@/types/telemetry";

const SIGNAL_COLORS: Record<IntersectionState, string> = {
  NORMAL: "#ef4444",
  CLEARING: "#10b981",
  PRIORITY_GREEN: "#22c55e",
  RECOVERY: "#f59e0b",
};
// Cascaded CLEARING keeps the purple cascade visual (`is_cascade` flag, not a state).
const CASCADE_COLOR = "#8b5cf6";

function signalColor({ state, is_cascade: isCascade }: IntersectionTelemetry): string {
  return state === "CLEARING" && isCascade ? CASCADE_COLOR : SIGNAL_COLORS[state];
}

type SignalMarkersProps = {
  map: Map | null;
  visible: boolean;
  routeGeometry: RouteGeometry | null;
  intersections: IntersectionTelemetry[];
};

export function SignalMarkers({ map, visible, routeGeometry, intersections }: SignalMarkersProps) {
  const markers = useRef(new globalThis.Map<string, Marker>());
  useEffect(() => {
    const currentMarkers = markers.current;
    return () => {
      currentMarkers.forEach((marker) => marker.remove());
      currentMarkers.clear();
    };
  }, [map]);

  useEffect(() => {
    const currentMarkers = markers.current;
    const ids = new Set(intersections.map((intersection) => intersection.id));
    currentMarkers.forEach((marker, id) => {
      if (!visible || !routeGeometry || !ids.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });
    if (!map || !visible || !routeGeometry) return;
    intersections.forEach((intersection, index) => {
      // Synthetic positions only: the telemetry contract has no signal coordinates.
      const coordinates = positionOnRoute(routeGeometry, (index + 1) / (intersections.length + 1));
      if (!coordinates) return;
      let marker = currentMarkers.get(intersection.id);
      if (!marker) {
        const element = document.createElement("div");
        element.className = "relative size-4";
        const dot = document.createElement("span");
        dot.className = "block size-4 rounded-full border-2 border-background shadow-lg";
        const label = document.createElement("span");
        label.className =
          "absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap rounded border border-border bg-card/95 px-2 py-1 font-mono text-[9px] text-foreground";
        element.append(dot, label);
        marker = new Marker({ element, anchor: "center" }).setLngLat(coordinates).addTo(map);
        currentMarkers.set(intersection.id, marker);
      }
      marker.setLngLat(coordinates);
      const element = marker.getElement();
      element.setAttribute(
        "aria-label",
        `Simulated signal ${intersection.id}: ${intersection.state}`,
      );
      const dot = element.firstElementChild as HTMLElement;
      dot.style.backgroundColor = signalColor(intersection);
      dot.classList.toggle("dashboard-signal-pulse", intersection.is_active_corridor);
      const label = element.lastElementChild as HTMLElement;
      label.textContent = `${intersection.id} · ${intersection.state}${intersection.is_cascade ? " · CASCADE" : ""}`;
    });
  }, [map, visible, routeGeometry, intersections]);

  return null;
}
