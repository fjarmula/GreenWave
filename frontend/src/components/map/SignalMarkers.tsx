"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, type Map } from "maplibre-gl";
import {
  coarseMarkerIds,
  coarseMarkerLabels,
  createSignalPhaseLayer,
  phaseMarkerView,
  type PhaseMarkerHandle,
  type PhaseMarkerLayout,
  type SignalPhaseLayer,
} from "@/lib/signal-phase-layer";
import { isCascadeClearing } from "@/lib/signal-visuals";
import type {
  IntersectionState,
  IntersectionTelemetry,
  RouteIntersection,
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

/** A DOM marker for one simulated phase, offset by the grouped layout so neighbours never overlap. */
function createPhaseMarker(map: Map, item: PhaseMarkerLayout): PhaseMarkerHandle {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  element.className =
    "flex items-center gap-1 rounded-md border border-dashed border-border bg-card/95 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-foreground shadow-lg";
  const light = document.createElement("span");
  light.className = "block size-2.5 shrink-0 rounded-full ring-1 ring-black/30";
  const text = document.createElement("span");
  element.append(light, text);
  const marker = new Marker({ element, anchor: "center", offset: item.offset })
    .setLngLat([item.phase.position.lng, item.phase.position.lat])
    .addTo(map);
  return {
    update({ phase, offset }) {
      const view = phaseMarkerView(phase);
      marker.setLngLat([phase.position.lng, phase.position.lat]).setOffset(offset);
      element.setAttribute("aria-label", view.ariaLabel);
      element.title = view.title;
      light.style.backgroundColor = view.swatch;
      text.textContent = view.text;
    },
    remove: () => marker.remove(),
  };
}

const NO_PHASES: SignalPhaseIndicator[] = [];

type SignalMarkersProps = {
  map: Map | null;
  visible: boolean;
  /** Positions from the start response, joined to tick intersections by id. */
  routeIntersections: RouteIntersection[];
  intersections: IntersectionTelemetry[];
  /**
   * Simulated phase lights from the tick, drawn only at high zoom where they replace the dots of
   * their intersections; an intersection without phases keeps its dot, labelled detail unavailable.
   */
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
  const shownPhases = visible ? phases : NO_PHASES;
  const dotIds = useMemo(
    () =>
      coarseMarkerIds(
        intersections.map((intersection) => intersection.id),
        shownPhases,
        detailed,
      ),
    [intersections, shownPhases, detailed],
  );

  useEffect(() => {
    if (!map) return;
    const layer = createSignalPhaseLayer(map, (item) => createPhaseMarker(map, item), setDetailed);
    phaseLayer.current = layer;
    return () => {
      layer.destroy();
      phaseLayer.current = null;
    };
  }, [map]);

  useEffect(() => {
    phaseLayer.current?.setPhases(shownPhases);
  }, [map, shownPhases]);

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
    currentMarkers.forEach((marker, id) => {
      if (!visible || !dotIds.has(id) || !positions.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });
    if (!map || !visible) return;
    intersections.forEach((intersection) => {
      if (!dotIds.has(intersection.id)) return;
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
      const labels = coarseMarkerLabels(intersection, isCascadeClearing(intersection), detailed);
      const element = marker.getElement();
      element.setAttribute("aria-label", labels.ariaLabel);
      const dot = element.firstElementChild as HTMLElement;
      dot.style.backgroundColor = signalColor(intersection);
      dot.classList.toggle("dashboard-signal-pulse", intersection.is_active_corridor);
      const label = element.lastElementChild as HTMLElement;
      label.textContent = labels.text;
    });
  }, [map, visible, dotIds, detailed, routeIntersections, intersections]);

  return null;
}
