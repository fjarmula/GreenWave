import { describe, expect, it } from "vitest";

import { mapPalette } from "@/components/map/map-palette";

const HEX = /^#[0-9a-f]{6}$/;

function lightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r + g + b) / 3;
}

function relativeLuminance(hex: string): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("mapPalette", () => {
  it.each(["light", "dark"] as const)("gives the %s basemap every colour", (theme) => {
    const { basemap } = mapPalette(theme);
    const keys = [
      "ground",
      "street",
      "streetCasing",
      "majorStreet",
      "water",
      "park",
      "building",
      "label",
      "labelHalo",
    ] as const;
    for (const key of keys) expect(basemap[key], key).toMatch(HEX);
    const [hi, lo] = [basemap.label, basemap.ground].map(relativeLuminance).sort((x, y) => y - x);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

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
