import { describe, expect, it } from "vitest";

import {
  attributionOptions,
  collapseCompactAttribution,
  peekAttributionOnHover,
} from "@/components/map/attribution";
import { DATA_ATTRIBUTION } from "@/components/map/useMaplibreMap";

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

describe("DATA_ATTRIBUTION", () => {
  it("leaves the simulation disclaimer to the provenance chip", () => {
    expect(DATA_ATTRIBUTION.join(" ").toLowerCase()).not.toContain("simulated");
  });
});

describe("attributionOptions", () => {
  it("always collapses the attribution behind the info button", () => {
    expect(attributionOptions()).toEqual({ compact: true, customAttribution: DATA_ATTRIBUTION });
  });
});

function fakeDetails() {
  const classes = new Set(["maplibregl-ctrl-attrib", "maplibregl-compact"]);
  const listeners = new Map<string, (event: { pointerType?: string }) => void>();
  const element = {
    open: false,
    classList: {
      contains: (name: string) => classes.has(name),
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    setAttribute: (name: string) => {
      if (name === "open") element.open = true;
    },
    removeAttribute: (name: string) => {
      if (name === "open") element.open = false;
    },
    addEventListener: (name: string, listener: (event: { pointerType?: string }) => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const root = {
    querySelector: (selector: string) => (selector === ".maplibregl-ctrl-attrib" ? element : null),
  };
  const fire = (name: string, pointerType = "mouse") => listeners.get(name)?.({ pointerType });
  return { root, element, classes, listeners, fire };
}

describe("peekAttributionOnHover", () => {
  it("opens on mouse enter and closes on leave", () => {
    const { root, element, classes, fire } = fakeDetails();
    peekAttributionOnHover(root);
    fire("pointerenter");
    expect(element.open).toBe(true);
    expect(classes.has("attrib-peek")).toBe(true);
    fire("pointerleave");
    expect(element.open).toBe(false);
    expect(classes.has("attrib-peek")).toBe(false);
  });

  it("ignores touch so a tap toggles through the button alone", () => {
    const { root, element, fire } = fakeDetails();
    peekAttributionOnHover(root);
    fire("pointerenter", "touch");
    expect(element.open).toBe(false);
  });

  it("keeps a clicked (pinned) attribution open after the pointer leaves", () => {
    const { root, element, classes, fire } = fakeDetails();
    peekAttributionOnHover(root);
    fire("pointerenter");
    fire("click");
    classes.add("maplibregl-compact-show");
    fire("pointerleave");
    expect(element.open).toBe(true);
    expect(classes.has("attrib-peek")).toBe(false);
  });

  it("leaves an already pinned attribution alone on hover", () => {
    const { root, classes, fire } = fakeDetails();
    classes.add("maplibregl-compact-show");
    peekAttributionOnHover(root);
    fire("pointerenter");
    expect(classes.has("attrib-peek")).toBe(false);
  });

  it("removes its listeners on cleanup", () => {
    const { root, listeners } = fakeDetails();
    peekAttributionOnHover(root)();
    expect(listeners.size).toBe(0);
  });
});
