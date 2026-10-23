import { describe, expect, it } from "vitest";

import { mapPalette } from "@/components/map/map-palette";

const HEX = /^#[0-9a-f]{6}$/;

function lightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r + g + b) / 3;
}

describe("mapPalette", () => {
  it.each(["light", "dark"] as const)("gives every %s colour as a hex string", (theme) => {
    const palette = mapPalette(theme);
    const values = [
      palette.routeCasing,
      palette.routeLive,
      palette.cascade,
      palette.endpointLine,
      ...Object.values(palette.signal),
    ];
    for (const value of values) expect(value).toMatch(HEX);
  });

  it("keeps clearing and priority green apart", () => {
    for (const theme of ["light", "dark"] as const) {
      const { signal } = mapPalette(theme);
      expect(signal.CLEARING).not.toBe(signal.PRIORITY_GREEN);
    }
  });

  it("cases the route against the basemap: light on light maps, dark on dark maps", () => {
    expect(lightness(mapPalette("light").routeCasing)).toBeGreaterThan(200);
    expect(lightness(mapPalette("dark").routeCasing)).toBeLessThan(40);
  });

  it("brightens the live route on dark maps", () => {
    expect(lightness(mapPalette("dark").routeLive)).toBeGreaterThan(
      lightness(mapPalette("light").routeLive),
    );
  });
});
