import { describe, expect, it } from "vitest";

import { collapseCompactAttribution } from "@/components/map/attribution";

function fakeAttribution(classes: string[], open: boolean) {
  const classList = new Set(classes);
  const element = {
    classList: {
      contains: (name: string) => classList.has(name),
      remove: (name: string) => classList.delete(name),
    },
    open,
    removeAttribute: (name: string) => {
      if (name === "open") element.open = false;
    },
  };
  const root = {
    querySelector: (selector: string) => (selector === ".maplibregl-ctrl-attrib" ? element : null),
  };
  return { root, element, classList };
}

describe("collapseCompactAttribution", () => {
  it("closes an expanded compact attribution", () => {
    const { root, element, classList } = fakeAttribution(
      ["maplibregl-ctrl-attrib", "maplibregl-compact", "maplibregl-compact-show"],
      true,
    );
    collapseCompactAttribution(root);
    expect(classList.has("maplibregl-compact-show")).toBe(false);
    expect(element.open).toBe(false);
  });

  it("leaves a full-width attribution alone", () => {
    const { root, element, classList } = fakeAttribution(["maplibregl-ctrl-attrib"], true);
    collapseCompactAttribution(root);
    expect(classList.has("maplibregl-ctrl-attrib")).toBe(true);
    expect(element.open).toBe(true);
  });

  it("tolerates a map without attribution", () => {
    expect(() => collapseCompactAttribution({ querySelector: () => null })).not.toThrow();
  });
});
