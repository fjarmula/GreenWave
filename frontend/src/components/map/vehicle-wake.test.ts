import { describe, expect, it, vi } from "vitest";

import { mapPalette } from "@/components/map/map-palette";
import { attachVehicleWake, VEHICLE_WAKE_LAYER } from "@/components/map/vehicle-wake";
import { distanceAlongRoute } from "@/lib/route-position";
import type { RouteGeometry } from "@/types/telemetry";

// About 222 m due north along one meridian, with a bend at the midpoint.
const ROUTE: RouteGeometry = {
  type: "LineString",
  coordinates: [
    [19.9, 50.0],
    [19.9, 50.001],
    [19.9, 50.002],
  ],
};

function fakeMap() {
  const sources = new Map<string, { spec: unknown; data?: unknown; setData(d: unknown): void }>();
  const layers = new Map<string, unknown>();
  return {
    sources,
    layers,
    addSource: vi.fn((id: string, spec: unknown) => {
      const source = {
        spec,
        data: undefined as unknown,
        setData: (d: unknown) => (source.data = d),
      };
      sources.set(id, source);
    }),
    addLayer: vi.fn((layer: { id: string }) => layers.set(layer.id, layer)),
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
  };
}

// The fake implements only what the wake calls; MapLibre's chaining return types are irrelevant.
const asMap = (map: ReturnType<typeof fakeMap>) =>
  map as unknown as Parameters<typeof attachVehicleWake>[0];

describe("attachVehicleWake", () => {
  it("adds a gradient line on a line-metrics source", () => {
    const map = fakeMap();
    attachVehicleWake(asMap(map), mapPalette("light"));
    const [, source] = map.addSource.mock.calls[0];
    expect(source).toMatchObject({ type: "geojson", lineMetrics: true });
    const layer = map.layers.get(VEHICLE_WAKE_LAYER) as { paint: Record<string, unknown> };
    expect(JSON.stringify(layer.paint["line-gradient"])).toContain("line-progress");
  });

  it("trails the last 120 m of route behind the vehicle", () => {
    const map = fakeMap();
    const wake = attachVehicleWake(asMap(map), mapPalette("light"));
    wake.show(ROUTE, [19.9, 50.0015]);
    const data = [...map.sources.values()][0].data as {
      geometry: { coordinates: [number, number][] };
    };
    const coordinates = data.geometry.coordinates;
    const first = distanceAlongRoute(ROUTE, coordinates[0]) ?? 0;
    const last = distanceAlongRoute(ROUTE, coordinates.at(-1)!) ?? 0;
    expect(last - first).toBeCloseTo(120, 0);
    expect(coordinates).toContainEqual([19.9, 50.001]); // keeps the bend vertex
  });

  it("removes its layer and source", () => {
    const map = fakeMap();
    attachVehicleWake(asMap(map), mapPalette("dark")).remove();
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
