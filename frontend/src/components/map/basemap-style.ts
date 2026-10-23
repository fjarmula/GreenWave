import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import { mapPalette, type BasemapPalette } from "@/components/map/map-palette";
import type { ResolvedTheme } from "@/lib/theme-transition";

// Source layers by role, in CARTO's schema (positron / dark-matter) and OpenMapTiles'.
const WATER = new Set(["water", "waterway"]);
const GREEN = new Set(["landuse", "landcover", "park"]);
const BUILDINGS = new Set(["buildings", "building"]);
const ROADS = new Set(["roads", "transportation"]);
const POIS = new Set(["pois", "poi"]);

const MAJOR_ROAD = /(^|_)(mot|motorway|trunk|pri|primary)(_|$)/;
const CASING = /(case|casing)/;

/** The paint a layer takes in the soft glass basemap, or null to leave it as CARTO drew it. */
function paintFor(
  layer: LayerSpecification,
  palette: BasemapPalette,
): Record<string, string> | null {
  const sourceLayer = "source-layer" in layer ? (layer["source-layer"] ?? "") : "";
  switch (layer.type) {
    case "background":
      return { "background-color": palette.ground };
    case "fill":
      if (WATER.has(sourceLayer)) return { "fill-color": palette.water };
      if (BUILDINGS.has(sourceLayer)) return { "fill-color": palette.building };
      if (GREEN.has(sourceLayer))
        return { "fill-color": layer.id.includes("residential") ? palette.ground : palette.park };
      return null;
    case "line":
      if (WATER.has(sourceLayer)) return { "line-color": palette.water };
      if (!ROADS.has(sourceLayer) || layer.id.includes("rail")) return null;
      if (CASING.test(layer.id)) return { "line-color": palette.streetCasing };
      return { "line-color": MAJOR_ROAD.test(layer.id) ? palette.majorStreet : palette.street };
    case "symbol":
      return { "text-color": palette.label, "text-halo-color": palette.labelHalo };
    default:
      return null;
  }
}

/**
 * Recolours the CARTO basemap to the soft glass palette: pale ground, white streets with a faint
 * casing, pale water and parks, muted labels (dark: the graphite equivalents). POI symbols are
 * hidden as noise; rail, boundaries and unknown layers keep CARTO's paint. Pure: returns a new
 * style and leaves `style` untouched, so it can run as MapLibre's `transformStyle`.
 */
export function restyleBasemap(
  style: StyleSpecification,
  theme: ResolvedTheme,
): StyleSpecification {
  const palette = mapPalette(theme).basemap;
  const layers = style.layers.map((layer): LayerSpecification => {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    if (layer.type === "symbol" && sourceLayer && POIS.has(sourceLayer))
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    const paint = paintFor(layer, palette);
    if (!paint) return layer;
    return {
      ...layer,
      paint: { ...("paint" in layer ? layer.paint : {}), ...paint },
    } as LayerSpecification;
  });
  return { ...style, layers };
}

/** Painted until the basemap arrives (or when it cannot), so no unstyled CARTO frame shows. */
export function groundOnlyStyle(theme: ResolvedTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "ground",
        type: "background",
        paint: { "background-color": mapPalette(theme).basemap.ground },
      },
    ],
  };
}

/** The slice of a MapLibre map the basemap loader needs. */
export type BasemapTarget = {
  setStyle(
    style: string | StyleSpecification,
    options: {
      diff?: boolean;
      transformStyle?: (
        previous: StyleSpecification | undefined,
        next: StyleSpecification,
      ) => StyleSpecification;
    },
  ): void;
  on(type: "error" | "style.load", listener: (event: { error?: { url?: string } }) => void): void;
};

/**
 * Loads basemaps recoloured for a theme. When the style itself cannot be fetched (CARTO down,
 * offline), the theme's ground-only style loads instead, so `style.load` still fires and the map
 * shows the right theme's ground rather than the previous one. Tile errors are left to MapLibre.
 */
export function createBasemapLoader(target: BasemapTarget) {
  let pending: { url: string; theme: ResolvedTheme } | null = null;
  target.on("style.load", () => (pending = null));
  target.on("error", (event) => {
    if (!pending || event.error?.url !== pending.url) return;
    const { theme } = pending;
    pending = null;
    target.setStyle(groundOnlyStyle(theme), { diff: false });
  });
  return (url: string, theme: ResolvedTheme) => {
    pending = { url, theme };
    target.setStyle(url, { transformStyle: (_previous, next) => restyleBasemap(next, theme) });
  };
}
