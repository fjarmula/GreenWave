import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    tokens[name] = value.trim();
  return tokens;
}

const light = block(":root");
const themes = { light, dark: { ...light, ...block(".dark") } };

type Rgba = { r: number; g: number; b: number; a: number };

function resolve(tokens: Record<string, string>, name: string): string {
  let value = tokens[name];
  if (value === undefined) throw new Error(`missing token ${name}`);
  for (let depth = 0; value.startsWith("var("); depth++) {
    if (depth > 8) throw new Error(`var() loop at ${name}`);
    value = tokens[value.slice(4, -1).trim()];
  }
  return value;
}

/** OKLCH → gamma-encoded sRGB (0–1), via OKLab and linear sRGB. */
function oklch(value: string): Rgba {
  const match = value.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/,
  );
  if (!match) throw new Error(`not an oklch() colour: ${value}`);
  const [L, C, H] = [Number(match[1]), Number(match[2]), (Number(match[3]) * Math.PI) / 180];
  const a = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  const [A, B] = [C * Math.cos(H), C * Math.sin(H)];
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
  const [r, g, b] = linear.map((c) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055,
  );
  return { r, g, b, a };
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (x: number, y: number) => x * top.a + y * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(tokens: Record<string, string>, text: string, surface: string): number {
  const bg = over(oklch(resolve(tokens, surface)), oklch(resolve(tokens, "--bg")));
  const fg = over(oklch(resolve(tokens, text)), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hex(value: string): Rgba {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return { r, g, b, a: 1 };
}

/** Text on the glass material composited over what the map shows beneath it. */
function glassContrast(tokens: Record<string, string>, text: string, beneath: string): number {
  const bg = over(oklch(resolve(tokens, "--glass-bg")), hex(beneath));
  const fg = over(oklch(resolve(tokens, text)), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Worst case beneath the glass: a white street in light, the dark map ground in dark.
const MAP_BENEATH = { light: "#ffffff", dark: "#1b1d21" };

const SURFACES = ["--bg", "--surface-1", "--surface-2", "--tile"];
const TEXT_PAIRS: Array<[string, string]> = [
  ...SURFACES.map((surface): [string, string] => ["--fg", surface]),
  ...SURFACES.map((surface): [string, string] => ["--fg-muted", surface]),
  ["--fg-muted", "--surface-3"],
  ["--primary-foreground", "--primary"],
  ...["--go", "--caution", "--emergency", "--beacon", "--cascade"].flatMap((tone) =>
    ["--bg", "--surface-1"].map((surface): [string, string] => [tone, surface]),
  ),
];

describe.each(Object.entries(themes))("%s theme tokens", (name, tokens) => {
  it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (text, surface) => {
    expect(contrast(tokens, text, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["--fg", "--fg-muted"])("%s on glass over the map meets 4.5:1", (text) => {
    const beneath = MAP_BENEATH[name as keyof typeof MAP_BENEATH];
    expect(glassContrast(tokens, text, beneath)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps neutrals near-neutral (chroma ≤ 0.012)", () => {
    for (const name of [
      "--bg",
      "--surface-1",
      "--surface-2",
      "--surface-3",
      "--fg",
      "--fg-muted",
    ]) {
      const chroma = Number(resolve(tokens, name).match(/^oklch\(\s*[\d.]+\s+([\d.]+)/)?.[1]);
      expect(chroma, name).toBeLessThanOrEqual(0.012);
    }
  });

  it("steps surfaces up in lightness", () => {
    const lightness = (name: string) =>
      Number(resolve(tokens, name).match(/^oklch\(\s*([\d.]+)/)?.[1]);
    if (tokens === themes.dark) {
      expect(lightness("--surface-1")).toBeGreaterThan(lightness("--bg"));
      expect(lightness("--surface-2")).toBeGreaterThan(lightness("--surface-1"));
      expect(lightness("--surface-3")).toBeGreaterThan(lightness("--surface-2"));
    }
  });
});

describe("dark hairlines", () => {
  it("keep the border a subtle white veil (5–9% alpha)", () => {
    const { a, r } = oklch(resolve(themes.dark, "--border"));
    expect(r).toBeGreaterThan(0.95);
    expect(a).toBeGreaterThanOrEqual(0.05);
    expect(a).toBeLessThanOrEqual(0.09);
  });
});

describe("surface system", () => {
  it("radii follow the soft glass scale", () => {
    expect(light["--radius-control"]).toBe("12px");
    expect(light["--radius-card"]).toBe("14px");
    expect(light["--radius-sheet"]).toBe("22px");
    expect(css).not.toMatch(/--radius-(inner|surface)\b/);
  });

  it("rounds only with the radius tokens", () => {
    const literal = [...css.matchAll(/border(?:-[a-z]+)?-radius:\s*([\d.]+rem)/g)].map((m) => m[0]);
    expect(literal).toEqual([]);
  });

  it("glass has an opaque fallback", () => {
    const start = css.indexOf("@supports not (backdrop-filter");
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf("}", start))).toContain(
      "background-color: var(--surface-2)",
    );
    expect(rule("@utility surface-glass")).toContain("backdrop-filter: blur(20px) saturate(1.6)");
    expect(css).not.toContain("surface-float");
  });

  it("has no in-flow panel shadow", () => {
    expect(css).not.toContain("--shadow-panel");
  });

  it("has no decorative radial-gradient glows", () => {
    expect(css).not.toMatch(/radial-gradient\([^;]*(--go|6 182 212)/);
  });
});

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("segmented controls", () => {
  it.each([".workspace-navigation", ".theme-toggle", ".hud-segmented"])(
    "%s sits on the shared track",
    (selector) => {
      expect(rule(selector)).toContain("var(--track)");
    },
  );

  it.each([
    '.workspace-navigation [aria-current="page"]',
    ".theme-toggle-thumb",
    '.hud-segment[aria-checked="true"]',
  ])("%s uses the shared thumb", (selector) => {
    expect(rule(selector)).toContain("var(--thumb)");
  });

  it("gives selected tabs the same thumb as checked segments", () => {
    expect(css).toMatch(
      /\.hud-segment\[aria-selected="true"\],\s*\.hud-segment\[aria-checked="true"\] \{/,
    );
  });

  it("separates thumb from track in both themes", () => {
    for (const tokens of Object.values(themes)) {
      expect(resolve(tokens, "--thumb")).not.toBe(resolve(tokens, "--track"));
    }
  });
});

describe("motion tokens", () => {
  it("defines press, hover, enter and exit durations", () => {
    for (const [name, ms] of [
      ["--dur-press", 120],
      ["--dur-hover", 150],
      ["--dur-enter", 200],
      ["--dur-exit", 150],
    ] as const) {
      expect(light[name]).toBe(`${ms}ms`);
    }
  });

  it("gives workspace buttons no drop shadow", () => {
    expect(rule(".workspace-button")).not.toContain("box-shadow");
  });
});

describe("inspector", () => {
  it("flattens its sections into one surface", () => {
    const flat = rule(".workspace-inspector .hud-panel");
    expect(flat).toContain("background: transparent");
    expect(flat).toContain("border-radius: 0");
  });

  it("separates flattened sections with a hairline", () => {
    expect(rule(".workspace-inspector .hud-panel + .hud-panel")).toContain(
      "border-top: 1px solid var(--border)",
    );
  });

  it("gives switches and ranges the single accent, not their tone", () => {
    expect(rule('.hud-switch[aria-checked="true"]')).toContain("var(--primary)");
    expect(rule(".hud-range::-webkit-slider-thumb")).toContain("var(--primary)");
    expect(css).not.toMatch(/hud-range[^{]*\{[^}]*var\(--beacon\)/);
  });

  it("keeps the primary action a 44px card-radius control without a glow", () => {
    const primary = rule("  .hud-primary");
    expect(primary).toContain("min-height: 2.75rem");
    expect(primary).toContain("border-radius: var(--radius-card)");
    expect(primary).not.toContain("box-shadow");
  });

  it("makes the danger action a soft red tile", () => {
    const start = css.lastIndexOf("\n  .hud-danger {");
    const danger = css.slice(start, css.indexOf("}", start));
    expect(danger).toContain("color-mix(in srgb, var(--emergency) 12%, transparent)");
    expect(danger).toContain("color: var(--emergency)");
  });

  it("breathes status dots instead of pulsing them", () => {
    expect(css).toMatch(/@keyframes status-breathe/);
  });
});

describe("numerals", () => {
  it("sets values in tabular sans, not mono", () => {
    const value = rule("  .hud-value");
    expect(value).toContain("font-variant-numeric: tabular-nums");
    expect(value).not.toContain("monospace");
  });
});

describe("dialog and fields", () => {
  it("dims the dialog backdrop without blurring it", () => {
    const backdrop = rule(".json-dialog::backdrop");
    expect(backdrop).not.toContain("backdrop-filter");
    expect(backdrop).toContain("oklch(0 0 0 / 50%)");
  });

  it("sits inputs on a borderless tile with a readable placeholder", () => {
    expect(rule("  .hud-input")).toContain("background: var(--tile)");
    expect(rule("  .hud-input")).toContain("border: 0");
    expect(rule("  .hud-input::placeholder")).toContain("color: var(--fg-muted)");
  });
});

describe("home", () => {
  it("lifts cards on hover with a neutral border, not the accent", () => {
    expect(rule("  .home-card:hover")).toContain("border-color: var(--border-strong)");
  });
});
