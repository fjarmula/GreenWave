/**
 * Lifecycle of the high-zoom simulated signal-phase markers, kept free of MapLibre and the DOM so
 * it is testable: the map supplies its zoom, the caller supplies how a marker is drawn. Phases and
 * positions come only from the tick contract; nothing is drawn for a phase that was not received.
 * An intersection without phases keeps its labelled state marker instead (`coarseMarkerIds`).
 */
import type {
  IntersectionTelemetry,
  SignalPhaseColor,
  SignalPhaseIndicator,
} from "@/types/telemetry";

/** Above the route fit (max zoom 16): phase detail appears only when the user zooms in further. */
export const SIGNAL_PHASE_DETAIL_ZOOM = 16.5;

export type ZoomSource = {
  getZoom(): number;
  project(coordinates: [number, number]): { x: number; y: number };
  on(type: "zoomend" | "moveend" | "resize", listener: () => void): void;
  off(type: "zoomend" | "moveend" | "resize", listener: () => void): void;
};

/** One phase marker and its screen offset (pixels) from its signal position. */
export type PhaseMarkerLayout = { phase: SignalPhaseIndicator; offset: [number, number] };

export type PhaseMarkerHandle = {
  update(item: PhaseMarkerLayout): void;
  remove(): void;
};

export type SignalPhaseLayer = {
  setPhases(phases: SignalPhaseIndicator[]): void;
  destroy(): void;
};

function phaseKey(phase: SignalPhaseIndicator): string {
  return `${phase.intersection_id}|${phase.signal_key}|${phase.kind}`;
}

/** Matches the fixed marker box in SignalMarkers, with a two-pixel collision gutter. */
export const PHASE_MARKER_WIDTH_PX = 112;
export const PHASE_MARKER_HEIGHT_PX = 20;
const PHASE_ROW_PIXELS = PHASE_MARKER_HEIGHT_PX + 2;

/**
 * Deterministic screen-space placement, ordered by intersection, signal and kind. Start with
 * stacked rows, then move a label below any overlapping box (including other intersections).
 * Geographic anchors stay unchanged; offsets account for the actual projected positions.
 * Quadratic in the number of phase labels; no GIS processing is done here.
 */
export function layoutPhaseMarkers(
  phases: SignalPhaseIndicator[],
  project: ZoomSource["project"],
): Map<string, PhaseMarkerLayout> {
  const groups = new Map<string, SignalPhaseIndicator[]>();
  for (const phase of phases) {
    const group = groups.get(phase.intersection_id) ?? [];
    group.push(phase);
    groups.set(phase.intersection_id, group);
  }
  const layout = new Map<string, PhaseMarkerLayout>();
  const placed: Array<{ x: number; y: number }> = [];
  [...groups.keys()].sort().forEach((intersectionId) => {
    const members = [...(groups.get(intersectionId) ?? [])].sort(
      (a, b) =>
        a.signal_key.localeCompare(b.signal_key) ||
        Number(a.kind === "PEDESTRIAN") - Number(b.kind === "PEDESTRIAN"),
    );
    members.forEach((phase, index) => {
      const row = (index - (members.length - 1) / 2) * PHASE_ROW_PIXELS;
      const point = project([phase.position.lng, phase.position.lat]);
      let y = point.y + row;
      // Sorted tops let each collision move us down once; earlier boxes stay cleared.
      for (const box of placed) {
        if (
          Math.abs(box.x - point.x) < PHASE_MARKER_WIDTH_PX + 2 &&
          Math.abs(y - box.y) < PHASE_ROW_PIXELS
        ) {
          y = box.y + PHASE_ROW_PIXELS;
        }
      }
      const insertion = placed.findIndex((box) => box.y > y);
      placed.splice(insertion < 0 ? placed.length : insertion, 0, { x: point.x, y });
      layout.set(phaseKey(phase), { phase, offset: [0, y - point.y] });
    });
  });
  return layout;
}

/** Short visible text; colour alone never carries the state. */
export function phaseMarkerText(phase: SignalPhaseIndicator): string {
  return `SIM ${phase.kind === "VEHICLE" ? "CAR" : "PED"} ${phase.color}`;
}

const PHASE_SWATCHES: Record<SignalPhaseColor, string> = {
  RED: "#ef4444",
  YELLOW: "#facc15",
  GREEN: "#22c55e",
};

/** Everything a phase marker shows: swatch colour plus text, title and ARIA label. */
export function phaseMarkerView(phase: SignalPhaseIndicator): {
  text: string;
  title: string;
  ariaLabel: string;
  swatch: string;
} {
  return {
    text: phaseMarkerText(phase),
    title: phase.accessible_label,
    ariaLabel: phase.accessible_label,
    swatch: PHASE_SWATCHES[phase.color],
  };
}

/**
 * Intersections that keep their coarse state marker: all of them below the detail zoom; at detail
 * zoom only those without a received phase, so none disappears for lack of phase geometry.
 */
export function coarseMarkerIds(
  intersectionIds: string[],
  phases: SignalPhaseIndicator[],
  detailed: boolean,
): Set<string> {
  const phased = new Set(detailed ? phases.map((phase) => phase.intersection_id) : []);
  return new Set(intersectionIds.filter((id) => !phased.has(id)));
}

/** Coarse marker text and ARIA label; `detailUnavailable` says so instead of inventing phases. */
export function coarseMarkerLabels(
  intersection: IntersectionTelemetry,
  cascade: boolean,
  detailUnavailable: boolean,
): { text: string; ariaLabel: string } {
  const { id, name, state } = intersection;
  const identity = name ? `${id} · ${name}` : id;
  return {
    text: `${identity} · ${state}${cascade ? " · CASCADE" : ""}${detailUnavailable ? " · SIM PHASES N/A" : ""}`,
    ariaLabel: `Simulated signal ${identity}: ${state}${detailUnavailable ? "; simulated phase detail unavailable" : ""}`,
  };
}

export function createSignalPhaseLayer(
  map: ZoomSource,
  createMarker: (item: PhaseMarkerLayout) => PhaseMarkerHandle,
  onDetailChange?: (detailed: boolean) => void,
): SignalPhaseLayer {
  let phases: SignalPhaseIndicator[] = [];
  let detailed: boolean | null = null;
  const markers = new Map<string, PhaseMarkerHandle>();

  const render = () => {
    const nowDetailed = map.getZoom() >= SIGNAL_PHASE_DETAIL_ZOOM;
    if (nowDetailed !== detailed) {
      detailed = nowDetailed;
      onDetailChange?.(nowDetailed);
    }
    const wanted = nowDetailed
      ? layoutPhaseMarkers(phases, (point) => map.project(point))
      : new Map<string, PhaseMarkerLayout>();
    markers.forEach((marker, key) => {
      if (!wanted.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    });
    wanted.forEach((item, key) => {
      let marker = markers.get(key);
      if (!marker) {
        marker = createMarker(item);
        markers.set(key, marker);
      }
      // Every item, every render: a group change moves its other members too.
      marker.update(item);
    });
  };

  map.on("zoomend", render);
  map.on("moveend", render);
  map.on("resize", render);
  render();
  return {
    setPhases(next) {
      phases = next;
      render();
    },
    destroy() {
      map.off("zoomend", render);
      map.off("moveend", render);
      map.off("resize", render);
      markers.forEach((marker) => marker.remove());
      markers.clear();
    },
  };
}
