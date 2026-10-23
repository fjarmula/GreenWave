import type { ResolvedTheme } from "@/lib/theme-transition";
import type { IntersectionState } from "@/types/telemetry";

export type MapPalette = {
  routeCasing: string;
  routeLive: string;
  cascade: string;
  endpointLine: string;
  signal: Record<IntersectionState, string>;
};

// MapLibre paint cannot read CSS variables; these are the globals.css OKLCH tokens in sRGB hex.
const PALETTES: Record<ResolvedTheme, MapPalette> = {
  light: {
    routeCasing: "#ffffff",
    routeLive: "#007e4b", // --go
    cascade: "#7544cd", // --cascade
    endpointLine: "#54585f", // --fg-muted
    signal: {
      NORMAL: "#d01c29", // --emergency
      CLEARING: "#008977", // --go shifted to teal (oklch 0.56 0.11 180)
      PRIORITY_GREEN: "#007e4b", // --go
      RECOVERY: "#a45e00", // --caution
    },
  },
  dark: {
    routeCasing: "#0a0c10", // --bg
    routeLive: "#36da90", // --go
    cascade: "#b296ff", // --cascade
    endpointLine: "#a1a5ab", // --fg-muted
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
