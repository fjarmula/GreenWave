"use client";

import { useEffect, useRef } from "react";
import { Marker, type Map } from "maplibre-gl";
import { isCascadeClearing } from "@/lib/signal-visuals";
import type {
  IntersectionState,
  IntersectionTelemetry,
  RouteIntersection,
} from "@/types/telemetry";

const SIGNAL_COLORS: Record<IntersectionState, string> = {
  NORMAL: "#ef4444",
  CLEARING: "#10b981",
  PRIORITY_GREEN: "#22c55e",
  RECOVERY: "#f59e0b",
};
// Cascaded CLEARING keeps the purple cascade visual (`is_cascade` flag, not a state).
const CASCADE_COLOR = "#8b5cf6";

function signalColor(intersection: IntersectionTelemetry): string {
  return isCascadeClearing(intersection) ? CASCADE_COLOR : SIGNAL_COLORS[intersection.state];
}

type SignalMarkersProps = {
  map: Map | null;
  visible: boolean;
  /** Positions from the start response, joined to tick intersections by id. */
  routeIntersections: RouteIntersection[];
  intersections: IntersectionTelemetry[];
};

export function SignalMarkers({
  map,
  visible,
  routeIntersections,
  intersections,
}: SignalMarkersProps) {
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
    const positions = new globalThis.Map(
      routeIntersections.map(({ id, position }) => [id, position] as const),
    );
    const ids = new Set(intersections.map((intersection) => intersection.id));
    currentMarkers.forEach((marker, id) => {
      if (!visible || !ids.has(id) || !positions.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });
    if (!map || !visible) return;
    intersections.forEach((intersection) => {
      // No position is invented: an intersection missing from the start response is not drawn.
      const position = positions.get(intersection.id);
      if (!position) return;
      const coordinates: [number, number] = [position.lng, position.lat];
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
      label.textContent = `${intersection.id} · ${intersection.state}${isCascadeClearing(intersection) ? " · CASCADE" : ""}`;
    });
  }, [map, visible, routeIntersections, intersections]);

  return null;
}
