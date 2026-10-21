import { describe, expect, it } from "vitest";

import {
  coarseMarkerIds,
  coarseMarkerLabels,
  createSignalPhaseLayer,
  layoutPhaseMarkers,
  phaseMarkerText,
  phaseMarkerView,
  SIGNAL_PHASE_DETAIL_ZOOM,
  type PhaseMarkerHandle,
  type PhaseMarkerLayout,
  type ZoomSource,
} from "@/lib/signal-phase-layer";
import type { IntersectionTelemetry, SignalPhaseIndicator } from "@/types/telemetry";

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
  const markers: Array<{
    shown: SignalPhaseIndicator;
    offset: [number, number];
    removed: boolean;
  }> = [];
  const create = (item: PhaseMarkerLayout): PhaseMarkerHandle => {
    const marker = { shown: item.phase, offset: item.offset, removed: false };
    markers.push(marker);
    return {
      update: (next) => {
        marker.shown = next.phase;
        marker.offset = next.offset;
      },
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

const CROSS_VEHICLE: SignalPhaseIndicator = {
  ...VEHICLE,
  signal_key: "OSM-L5",
  color: "RED",
  accessible_label: "Simulated vehicle signal OSM-L5 at INT-0360: red",
};
const CROSS_PEDESTRIAN: SignalPhaseIndicator = {
  ...CROSS_VEHICLE,
  kind: "PEDESTRIAN",
  color: "GREEN",
  accessible_label: "Simulated pedestrian signal OSM-L5 at INT-0360: green",
};
const ALL_AT_ONE_POINT = [VEHICLE, PEDESTRIAN, CROSS_VEHICLE, CROSS_PEDESTRIAN];

describe("layoutPhaseMarkers", () => {
  it("gives co-located markers of one intersection distinct, deterministic offsets", () => {
    const layout = layoutPhaseMarkers(ALL_AT_ONE_POINT);
    const offsets = [...layout.values()].map((item) => item.offset.join(","));

    expect(layout.size).toBe(4);
    expect(new Set(offsets).size).toBe(4);
    expect(layoutPhaseMarkers([...ALL_AT_ONE_POINT].reverse())).toEqual(layout);
    // Rows at least one label height apart: never a two-pixel left/right split.
    const rows = [...layout.values()].map((item) => item.offset[1]).sort((a, b) => a - b);
    rows.slice(1).forEach((row, index) => expect(row - rows[index]).toBeGreaterThanOrEqual(16));
  });

  it("keys items by intersection, signal and kind", () => {
    expect([...layoutPhaseMarkers([PEDESTRIAN]).keys()]).toEqual(["INT-0360|OSM-L4|PEDESTRIAN"]);
  });

  it("lays out each intersection independently", () => {
    const other = { ...VEHICLE, intersection_id: "INT-0366" };
    const layout = layoutPhaseMarkers([VEHICLE, other]);

    expect(layout.get("INT-0366|OSM-L4|VEHICLE")?.offset).toEqual([0, 0]);
    expect(layout.get("INT-0360|OSM-L4|VEHICLE")?.offset).toEqual([0, 0]);
  });

  it("draws a pedestrian-only signal as one pedestrian marker, never a car", () => {
    const layout = layoutPhaseMarkers([PEDESTRIAN]);

    expect(layout.size).toBe(1);
    expect([...layout.values()].map((item) => phaseMarkerText(item.phase))).toEqual([
      "SIM PED RED",
    ]);
  });
});

describe("signal phase layer layout", () => {
  it("recalculates every member's offset when its group changes", () => {
    const factory = markerFactory();
    const layer = createSignalPhaseLayer(new FakeMap(17), factory.create);
    layer.setPhases(ALL_AT_ONE_POINT);
    const before = factory.live().find((marker) => marker.shown === VEHICLE)?.offset;

    layer.setPhases([VEHICLE]);

    expect(before).not.toEqual([0, 0]);
    expect(factory.live()).toHaveLength(1);
    expect(factory.live()[0].offset).toEqual([0, 0]);
  });
});

describe("phaseMarkerView", () => {
  it("changes colour, text, title and ARIA label with the phase", () => {
    const green = phaseMarkerView(VEHICLE);
    const yellow = phaseMarkerView({
      ...VEHICLE,
      color: "YELLOW",
      accessible_label: "Simulated vehicle signal OSM-L4 at INT-0360: yellow",
    });

    expect(green).toMatchObject({ text: "SIM CAR GREEN", ariaLabel: VEHICLE.accessible_label });
    expect(green.title).toBe(green.ariaLabel);
    expect(yellow.text).toBe("SIM CAR YELLOW");
    expect(yellow.ariaLabel).toMatch(/yellow$/);
    expect(yellow.swatch).not.toBe(green.swatch);
  });
});

describe("coarse intersection fallback", () => {
  const INTERSECTION: IntersectionTelemetry = {
    id: "INT-0366",
    name: null,
    state: "NORMAL",
    is_cascade: false,
    tti_seconds: 12,
    is_active_corridor: false,
  };

  it("keeps every intersection's state marker below the detail zoom", () => {
    expect(coarseMarkerIds(["INT-0360", "INT-0366"], [VEHICLE], false)).toEqual(
      new Set(["INT-0360", "INT-0366"]),
    );
  });

  it("keeps the state marker at detail zoom only for an intersection without phases", () => {
    expect(coarseMarkerIds(["INT-0360", "INT-0366"], [VEHICLE], true)).toEqual(
      new Set(["INT-0366"]),
    );
    expect(coarseMarkerIds(["INT-0366"], [], true)).toEqual(new Set(["INT-0366"]));
  });

  it("labels phase detail unavailable, in text and ARIA, without inventing a phase", () => {
    const plain = coarseMarkerLabels(INTERSECTION, false, false);
    const unavailable = coarseMarkerLabels(INTERSECTION, false, true);

    expect(plain).toEqual({
      text: "INT-0366 · NORMAL",
      ariaLabel: "Simulated signal INT-0366: NORMAL",
    });
    expect(unavailable.text).toBe("INT-0366 · NORMAL · SIM PHASES N/A");
    expect(unavailable.ariaLabel).toBe(
      "Simulated signal INT-0366: NORMAL; simulated phase detail unavailable",
    );
    expect(coarseMarkerLabels(INTERSECTION, true, false).text).toBe("INT-0366 · NORMAL · CASCADE");
  });
});
