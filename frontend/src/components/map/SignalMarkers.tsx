"use client";

import { useEffect, useRef, useState } from "react";
import { Marker, type Map } from "maplibre-gl";
import {
  createSignalPhaseLayer,
  phaseMarkerText,
  type PhaseMarkerHandle,
  type SignalPhaseLayer,
} from "@/lib/signal-phase-layer";
import { isCascadeClearing } from "@/lib/signal-visuals";
import type {
  IntersectionState,
  IntersectionTelemetry,
  RouteIntersection,
  SignalPhaseColor,
  SignalPhaseIndicator,
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

const PHASE_COLORS: Record<SignalPhaseColor, string> = {
  RED: "#ef4444",
  YELLOW: "#facc15",
  GREEN: "#22c55e",
};

/** A DOM marker for one simulated phase; vehicle and pedestrian sit side by side on its signal. */
function createPhaseMarker(map: Map, phase: SignalPhaseIndicator): PhaseMarkerHandle {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  element.className =
    "flex items-center gap-1 rounded-md border border-dashed border-border bg-card/95 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-foreground shadow-lg";
  const light = document.createElement("span");
  light.className = "block size-2.5 shrink-0 rounded-full ring-1 ring-black/30";
  const text = document.createElement("span");
  element.append(light, text);
  // Vehicle label to the left of the signal point, pedestrian to the right: never overlapping.
  const marker = new Marker({
    element,
    anchor: phase.kind === "VEHICLE" ? "right" : "left",
    offset: phase.kind === "VEHICLE" ? [-2, 0] : [2, 0],
  })
    .setLngLat([phase.position.lng, phase.position.lat])
    .addTo(map);
  return {
    update(next) {
      marker.setLngLat([next.position.lng, next.position.lat]);
      element.setAttribute("aria-label", next.accessible_label);
      element.title = next.accessible_label;
      light.style.backgroundColor = PHASE_COLORS[next.color];
      text.textContent = phaseMarkerText(next);
    },
    remove: () => marker.remove(),
  };
}

type SignalMarkersProps = {
  map: Map | null;
  visible: boolean;
  /** Positions from the start response, joined to tick intersections by id. */
  routeIntersections: RouteIntersection[];
  intersections: IntersectionTelemetry[];
  /** Simulated phase lights from the tick, drawn only at high zoom where they replace the dots. */
  phases: SignalPhaseIndicator[];
};

export function SignalMarkers({
  map,
  visible,
  routeIntersections,
  intersections,
  phases,
}: SignalMarkersProps) {
  const markers = useRef(new globalThis.Map<string, Marker>());
  const phaseLayer = useRef<SignalPhaseLayer | null>(null);
  const [detailed, setDetailed] = useState(false);
  const showDots = visible && !detailed;

  useEffect(() => {
    if (!map) return;
    const layer = createSignalPhaseLayer(
      map,
      (phase) => createPhaseMarker(map, phase),
      setDetailed,
    );
    phaseLayer.current = layer;
    return () => {
      layer.destroy();
      phaseLayer.current = null;
    };
  }, [map]);

  useEffect(() => {
    phaseLayer.current?.setPhases(visible ? phases : []);
  }, [map, visible, phases]);

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
      if (!showDots || !ids.has(id) || !positions.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });
    if (!map || !showDots) return;
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
  }, [map, showDots, routeIntersections, intersections]);

  return null;
}
