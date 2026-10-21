/**
 * Lifecycle of the high-zoom simulated signal-phase markers, kept free of MapLibre and the DOM so
 * it is testable: the map supplies its zoom, the caller supplies how a marker is drawn. Phases and
 * positions come only from the tick contract; nothing is drawn for a phase that was not received.
 */
import type { SignalPhaseIndicator } from "@/types/telemetry";

/** Above the route fit (max zoom 16): phase detail appears only when the user zooms in further. */
export const SIGNAL_PHASE_DETAIL_ZOOM = 16.5;

export type ZoomSource = {
  getZoom(): number;
  on(type: "zoomend", listener: () => void): void;
  off(type: "zoomend", listener: () => void): void;
};

export type PhaseMarkerHandle = {
  update(phase: SignalPhaseIndicator): void;
  remove(): void;
};

export type SignalPhaseLayer = {
  setPhases(phases: SignalPhaseIndicator[]): void;
  destroy(): void;
};

function phaseKey(phase: SignalPhaseIndicator): string {
  return `${phase.intersection_id}|${phase.signal_key}|${phase.kind}`;
}

/** Short visible text; colour alone never carries the state. */
export function phaseMarkerText(phase: SignalPhaseIndicator): string {
  return `SIM ${phase.kind === "VEHICLE" ? "CAR" : "PED"} ${phase.color}`;
}

export function createSignalPhaseLayer(
  map: ZoomSource,
  createMarker: (phase: SignalPhaseIndicator) => PhaseMarkerHandle,
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
    const wanted = new Map(nowDetailed ? phases.map((phase) => [phaseKey(phase), phase]) : []);
    markers.forEach((marker, key) => {
      if (!wanted.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    });
    wanted.forEach((phase, key) => {
      let marker = markers.get(key);
      if (!marker) {
        marker = createMarker(phase);
        markers.set(key, marker);
      }
      marker.update(phase);
    });
  };

  map.on("zoomend", render);
  render();
  return {
    setPhases(next) {
      phases = next;
      render();
    },
    destroy() {
      map.off("zoomend", render);
      markers.forEach((marker) => marker.remove());
      markers.clear();
    },
  };
}
