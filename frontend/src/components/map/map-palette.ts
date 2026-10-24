import type { ResolvedTheme } from "@/lib/theme-transition";
import type { IntersectionState } from "@/types/telemetry";

/** Soft glass recolouring of the CARTO basemap (components/map/basemap-style.ts). */
export type BasemapPalette = {
  ground: string;
  street: string;
  streetCasing: string;
  majorStreet: string;
  water: string;
  park: string;
  building: string;
  label: string;
  labelHalo: string;
};

export type MapPalette = {
  basemap: BasemapPalette;
  routeCasing: string;
  routeLive: string;
  /** Standard-traffic runs: a neutral line, no green corridor. */
  routeStandard: string;
  /** The green wake trailing the vehicle in Green Wave runs. */
  wake: string;
  cascade: string;
  endpointLine: string;
  /** The walk from an off-road incident's access point (dotted). */
  onFootLine: string;
  signal: Record<IntersectionState, string>;
};

// MapLibre paint cannot read CSS variables; these are the globals.css OKLCH tokens in sRGB hex.
const PALETTES: Record<ResolvedTheme, MapPalette> = {
  light: {
    basemap: {
      ground: "#eef1f5",
      street: "#ffffff",
      streetCasing: "#dde2ea",
      majorStreet: "#ffffff",
      water: "#cfe3f2",
      park: "#dcefdc",
      building: "#e4e8ee",
      label: "#626975",
      labelHalo: "#ffffff",
    },
    routeCasing: "#ffffff",
    routeLive: "#007e4b", // --go
    routeStandard: "#8a919c",
    wake: "#007e4b", // --go
    cascade: "#7544cd", // --cascade
    endpointLine: "#54585f", // --fg-muted
    onFootLine: "#007598", // --beacon
    signal: {
      NORMAL: "#d01c29", // --emergency
      CLEARING: "#008977", // --go shifted to teal (oklch 0.56 0.11 180)
      PRIORITY_GREEN: "#007e4b", // --go
      RECOVERY: "#a45e00", // --caution
    },
  },
  dark: {
    basemap: {
      ground: "#1b1d21",
      street: "#2c2f35",
      streetCasing: "#24272c",
      majorStreet: "#383c43",
      water: "#1d2b3a",
      park: "#1f2b22",
      building: "#23262b",
      label: "#9aa0ab",
      labelHalo: "#1b1d21",
    },
    routeCasing: "#0f1114",
    routeLive: "#36da90", // --go
    routeStandard: "#6b717c",
    wake: "#36da90", // --go
    cascade: "#b296ff", // --cascade
    endpointLine: "#a1a5ab", // --fg-muted
    onFootLine: "#48ceea", // --beacon
    signal: {
      NORMAL: "#ff645f", // --emergency
      CLEARING: "#40d9c1", // --go shifted to teal (oklch 0.8 0.13 180)
      PRIORITY_GREEN: "#36da90", // --go
      RECOVERY: "#f7b83d", // --caution
    },
  },
};

export function mapPalette(theme: ResolvedTheme): MapPalette {
  return PALETTES[theme];
}
