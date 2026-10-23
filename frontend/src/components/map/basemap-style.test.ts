import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import {
  createBasemapLoader,
  groundOnlyStyle,
  restyleBasemap,
} from "@/components/map/basemap-style";
import { mapPalette } from "@/components/map/map-palette";

/** One layer per rule, shaped like CARTO's positron / dark-matter styles. */
function fixture(): StyleSpecification {
  const layer = (id: string, type: string, sourceLayer?: string, extra: object = {}) => ({
    id,
    type,
    ...(sourceLayer ? { source: "carto", "source-layer": sourceLayer } : {}),
    paint: {},
    ...extra,
  });
  return {
    version: 8,
    sources: {
      carto: { type: "vector", url: "https://tiles.example/carto.json" },
      sat: { type: "raster", tiles: ["https://tiles.example/{z}/{x}/{y}.png"] },
    },
    layers: [
      layer("background", "background"),
      layer("water", "fill", "water"),
      layer("waterway", "line", "water"),
      layer("landcover", "fill", "landuse"),
      layer("landuse_residential", "fill", "landuse"),
      layer("building", "fill", "buildings"),
      layer("road_minor_case", "line", "roads"),
      layer("road_minor_fill", "line", "roads"),
      layer("road_pri_fill_noramp", "line", "roads"),
      layer("road_mot_case_noramp", "line", "roads"),
      layer("rail", "line", "roads"),
      layer("roadname_minor", "symbol", "roads", { layout: { "text-field": "{name}" } }),
      layer("place_suburbs", "symbol", "places", { layout: { "text-field": "{name}" } }),
      layer("poi_park", "symbol", "pois", { layout: { "text-field": "{name}" } }),
      { id: "satellite", type: "raster", source: "sat", paint: { "raster-opacity": 0.5 } },
    ],
  } as StyleSpecification;
}

function paintOf(style: StyleSpecification, id: string): Record<string, unknown> {
  const layer = style.layers.find((item) => item.id === id);
  return (layer && "paint" in layer ? layer.paint : {}) as Record<string, unknown>;
}

describe.each(["light", "dark"] as const)("restyleBasemap (%s)", (theme) => {
  const { basemap } = mapPalette(theme);
  const style = restyleBasemap(fixture(), theme);

  it.each([
    ["background", "background-color", basemap.ground],
    ["water", "fill-color", basemap.water],
    ["waterway", "line-color", basemap.water],
    ["landcover", "fill-color", basemap.park],
    ["landuse_residential", "fill-color", basemap.ground],
    ["building", "fill-color", basemap.building],
    ["road_minor_case", "line-color", basemap.streetCasing],
    ["road_minor_fill", "line-color", basemap.street],
    ["road_pri_fill_noramp", "line-color", basemap.majorStreet],
    ["road_mot_case_noramp", "line-color", basemap.streetCasing],
    ["roadname_minor", "text-color", basemap.label],
    ["roadname_minor", "text-halo-color", basemap.labelHalo],
    ["place_suburbs", "text-color", basemap.label],
  ])("paints %s %s", (id, property, value) => {
    expect(paintOf(style, id)[property]).toBe(value);
  });

  it("hides POI symbols", () => {
    const poi = style.layers.find((layer) => layer.id === "poi_park");
    expect(poi && "layout" in poi ? poi.layout?.visibility : undefined).toBe("none");
  });

  it("leaves rail and unknown layers untouched", () => {
    const original = fixture();
    for (const id of ["rail", "satellite"]) {
      expect(style.layers.find((layer) => layer.id === id)).toEqual(
        original.layers.find((layer) => layer.id === id),
      );
    }
  });

  it("does not mutate its input", () => {
    const input = fixture();
    restyleBasemap(input, theme);
    expect(input).toEqual(fixture());
  });

  it("draws a ground-only style before the basemap loads", () => {
    const ground = groundOnlyStyle(theme);
    expect(ground.layers).toEqual([
      { id: "ground", type: "background", paint: { "background-color": basemap.ground } },
    ]);
  });
});

describe("createBasemapLoader", () => {
  function fakeMap() {
    type Listener = (event: { error?: { url?: string } }) => void;
    const handlers: Record<string, Listener[]> = {};
    return {
      setStyle: vi.fn(),
      on: (type: string, handler: Listener) => {
        (handlers[type] ??= []).push(handler);
      },
      emit: (type: string, event: { error?: { url?: string } } = {}) =>
        handlers[type]?.forEach((h) => h(event)),
    };
  }

  it("recolours every basemap it loads", () => {
    const map = fakeMap();
    createBasemapLoader(map)("https://carto/dark.json", "dark");
    const [url, options] = map.setStyle.mock.calls[0];
    expect(url).toBe("https://carto/dark.json");
    const ground = options.transformStyle(undefined, fixture()).layers[0].paint;
    expect(ground["background-color"]).toBe(mapPalette("dark").basemap.ground);
  });

  it("falls back to the theme's ground when the basemap cannot be fetched", () => {
    const map = fakeMap();
    createBasemapLoader(map)("https://carto/dark.json", "dark");
    map.emit("error", { error: { url: "https://carto/dark.json" } });
    expect(map.setStyle).toHaveBeenLastCalledWith(groundOnlyStyle("dark"), { diff: false });
  });

  it("ignores tile errors and errors after the style loaded", () => {
    const map = fakeMap();
    createBasemapLoader(map)("https://carto/dark.json", "dark");
    map.emit("error", { error: { url: "https://carto/tiles/1/2/3.pbf" } });
    map.emit("style.load");
    map.emit("error", { error: { url: "https://carto/dark.json" } });
    expect(map.setStyle).toHaveBeenCalledTimes(1);
  });
});
