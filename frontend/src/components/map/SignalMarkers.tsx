"use client";

import { mapPalette, type MapPalette } from "@/components/map/map-palette";
import type { ResolvedTheme } from "@/lib/theme-transition";
import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, type Map } from "maplibre-gl";
import {
  coarseMarkerIds,
  coarseMarkerLabels,
  createSignalPhaseLayer,
  phaseMarkerView,
  PHASE_MARKER_WIDTH_PX,
  PHASE_MARKER_HEIGHT_PX,
  type PhaseMarkerHandle,
  type PhaseMarkerLayout,
  type SignalPhaseLayer,
} from "@/lib/signal-phase-layer";
import { distinctStreetName, upcomingIntersectionIds } from "@/lib/driver-signal-labels";
import { isCascadeClearing, signalVisual } from "@/lib/signal-visuals";
import type {
  IntersectionTelemetry,
  RouteIntersection,
  SignalPhaseIndicator,
} from "@/types/telemetry";

// Cascaded CLEARING keeps the purple cascade visual (`is_cascade` flag, not a state).
function signalColor(intersection: IntersectionTelemetry, palette: MapPalette): string {
  return isCascadeClearing(intersection) ? palette.cascade : palette.signal[intersection.state];
}

/** A DOM marker for one simulated phase, offset by the grouped layout so neighbours never overlap. */
function createPhaseMarker(map: Map, item: PhaseMarkerLayout): PhaseMarkerHandle {
  const element = document.createElement("div");
  element.setAttribute("role", "img");
  element.className =
    "box-border flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border bg-card px-1.5 py-0.5 font-mono text-[9px] font-semibold text-foreground shadow-marker";
  element.style.width = `${PHASE_MARKER_WIDTH_PX}px`;
  element.style.height = `${PHASE_MARKER_HEIGHT_PX}px`;
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

const FULL_LABEL_CLASS =
  "absolute top-1/2 left-full ml-2 -translate-y-1/2 whitespace-nowrap surface-glass rounded-full! px-2 py-0.5 font-mono text-[10px] text-foreground";
// Driver labels: a short street name, one line; the dot colour carries the state.
const DRIVER_LABEL_CLASS =
  "absolute top-1/2 left-full ml-2 -translate-y-1/2 max-w-[11rem] truncate whitespace-nowrap surface-glass rounded-full! px-2 py-0.5 font-sans text-[11px] font-medium text-foreground";

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
  theme: ResolvedTheme;
  /** "driver": only the next junctions get a label, their distinguishing street name. */
  labels?: "full" | "driver";
};

export function SignalMarkers({
  map,
  visible,
  routeIntersections,
  intersections,
  phases,
  theme,
  labels = "full",
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
  const upcoming = useMemo(
    () => (labels === "driver" ? upcomingIntersectionIds(intersections) : null),
    [labels, intersections],
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
        element.className = "relative size-3";
        const dot = document.createElement("span");
        dot.className = "map-lamp";
        const label = document.createElement("span");
        element.append(dot, label);
        marker = new Marker({ element, anchor: "center" }).setLngLat(coordinates).addTo(map);
        currentMarkers.set(intersection.id, marker);
      }
      marker.setLngLat(coordinates);
      const markerLabels = coarseMarkerLabels(
        intersection,
        isCascadeClearing(intersection),
        detailed,
      );
      const element = marker.getElement();
      element.setAttribute("aria-label", markerLabels.ariaLabel);
      const dot = element.firstElementChild as HTMLElement;
      dot.style.backgroundColor = signalColor(intersection, mapPalette(theme));
      dot.toggleAttribute("data-halo", signalVisual(intersection).halo);
      const label = element.lastElementChild as HTMLElement;
      const text = upcoming
        ? upcoming.has(intersection.id)
          ? (distinctStreetName(intersection.id, routeIntersections) ?? "")
          : ""
        : markerLabels.text;
      label.className = upcoming ? DRIVER_LABEL_CLASS : FULL_LABEL_CLASS;
      label.textContent = text;
      label.hidden = !text;
    });
  }, [map, visible, dotIds, detailed, routeIntersections, intersections, theme, upcoming]);

  return null;
}
