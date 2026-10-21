import { describe, expect, it } from "vitest";

import {
  createSignalPhaseLayer,
  phaseMarkerText,
  SIGNAL_PHASE_DETAIL_ZOOM,
  type PhaseMarkerHandle,
  type ZoomSource,
} from "@/lib/signal-phase-layer";
import type { SignalPhaseIndicator } from "@/types/telemetry";

const VEHICLE: SignalPhaseIndicator = {
  intersection_id: "INT-0360",
  signal_key: "OSM-L4",
  kind: "VEHICLE",
  color: "GREEN",
  position: { lat: 50.0612, lng: 19.9571 },
  accessible_label: "Simulated vehicle signal OSM-L4 at INT-0360: green",
};
const PEDESTRIAN: SignalPhaseIndicator = {
  ...VEHICLE,
  kind: "PEDESTRIAN",
  color: "RED",
  accessible_label: "Simulated pedestrian signal OSM-L4 at INT-0360: red",
};

/** A MapLibre stand-in: a zoom level and its `zoomend` listeners. */
class FakeMap implements ZoomSource {
  listeners = new Set<() => void>();
  constructor(public zoom: number) {}
  getZoom() {
    return this.zoom;
  }
  on(_type: "zoomend", listener: () => void) {
    this.listeners.add(listener);
  }
  off(_type: "zoomend", listener: () => void) {
    this.listeners.delete(listener);
  }
  zoomTo(zoom: number) {
    this.zoom = zoom;
    this.listeners.forEach((listener) => listener());
  }
}

/** Records every marker the layer creates, what it shows and whether it was removed. */
function markerFactory() {
  const markers: Array<{ shown: SignalPhaseIndicator; removed: boolean }> = [];
  const create = (phase: SignalPhaseIndicator): PhaseMarkerHandle => {
    const marker = { shown: phase, removed: false };
    markers.push(marker);
    return {
      update: (next) => (marker.shown = next),
      remove: () => (marker.removed = true),
    };
  };
  const live = () => markers.filter((marker) => !marker.removed);
  return { create, markers, live };
}

describe("signal phase layer", () => {
  it("draws nothing below the detail zoom", () => {
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(
      new FakeMap(SIGNAL_PHASE_DETAIL_ZOOM - 0.1),
      factory.create,
    );

    layer.setPhases([VEHICLE, PEDESTRIAN]);

    expect(factory.markers).toEqual([]);
  });

  it("draws each phase at its backend position once zoomed in, and hides them again", () => {
    const map = new FakeMap(13);
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(map, factory.create);
    layer.setPhases([VEHICLE, PEDESTRIAN]);

    map.zoomTo(SIGNAL_PHASE_DETAIL_ZOOM);
    expect(factory.live().map((marker) => marker.shown)).toEqual([VEHICLE, PEDESTRIAN]);

    map.zoomTo(SIGNAL_PHASE_DETAIL_ZOOM - 1);
    expect(factory.live()).toEqual([]);
  });

  it("updates an existing marker's colour and label on the next tick", () => {
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(new FakeMap(17), factory.create);
    layer.setPhases([VEHICLE]);

    const yellow = { ...VEHICLE, color: "YELLOW" as const, accessible_label: "…: yellow" };
    layer.setPhases([yellow]);

    expect(factory.markers).toHaveLength(1);
    expect(factory.markers[0].shown).toBe(yellow);
  });

  it("removes markers whose phase disappears", () => {
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(new FakeMap(17), factory.create);
    layer.setPhases([VEHICLE, PEDESTRIAN]);

    layer.setPhases([PEDESTRIAN]);

    expect(factory.live().map((marker) => marker.shown)).toEqual([PEDESTRIAN]);
  });

  it("draws no invented marker when a tick carries no phases", () => {
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(new FakeMap(17), factory.create);

    layer.setPhases([]);

    expect(factory.markers).toEqual([]);
  });

  it("removes every marker and stops listening on destroy", () => {
    const map = new FakeMap(17);
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(map, factory.create);
    layer.setPhases([VEHICLE, PEDESTRIAN]);

    layer.destroy();

    expect(factory.live()).toEqual([]);
    expect(map.listeners.size).toBe(0);
  });

  it("reports when the detail level changes", () => {
    const map = new FakeMap(13);
    const changes: boolean[] = [];
    createSignalPhaseLayer(map, markerFactory().create, (detailed) => changes.push(detailed));

    map.zoomTo(17);
    map.zoomTo(17.5);
    map.zoomTo(12);

    expect(changes).toEqual([false, true, false]);
  });
});

describe("phaseMarkerText", () => {
  it("names the movement and colour in text, marked simulated", () => {
    expect(phaseMarkerText(VEHICLE)).toBe("SIM CAR GREEN");
    expect(phaseMarkerText(PEDESTRIAN)).toBe("SIM PED RED");
  });
});
