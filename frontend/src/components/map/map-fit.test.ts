import type { Map } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { applyEndpointFit } from "@/components/map/endpoint-fit";
import { measureMapPadding, OCCLUDER_SELECTOR } from "@/components/map/occluders";
import { applyRouteFit, routeFitCoordinates } from "@/components/map/useRouteFit";
import { occluderPadding, type Rect } from "@/lib/workspace-layout";

vi.mock("maplibre-gl", () => ({
  LngLatBounds: class {
    points: number[][];
    constructor(first: number[]) {
      this.points = [first];
    }
    extend(point: number[]) {
      this.points.push(point);
      return this;
    }
  },
}));

const element = (rect: Rect) => ({ getBoundingClientRect: () => rect });

/** A root that answers the occluder selector with the given elements. */
function fakeRoot(elements: ReturnType<typeof element>[]) {
  return {
    querySelectorAll: (selector: string) => (selector === OCCLUDER_SELECTOR ? elements : []),
  };
}

function fakeContainer(
  width: number,
  height: number,
  { shell = null, document }: { shell?: unknown; document?: unknown } = {},
) {
  return {
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height }),
    closest: (selector: string) => (selector === ".workspace-shell" ? shell : null),
    ownerDocument: document,
  };
}

/** Only what the fit helpers touch: container size, current view, and fitBounds. */
function fakeMap(width: number, height: number, container = fakeContainer(width, height)) {
  const fitBounds = vi.fn();
  const map = {
    getContainer: () => container,
    getBounds: () => ({
      getWest: () => 19.9,
      getSouth: () => 50.0,
      getEast: () => 20.0,
      getNorth: () => 50.1,
    }),
    fitBounds,
  } as unknown as Map;
  return { map, fitBounds };
}

const IN_VIEW: Array<[number, number]> = [
  [19.95, 50.05],
  [19.92, 50.08],
];
const OFF_SCREEN: Array<[number, number]> = [
  [19.95, 50.05],
  [20.3, 50.05],
];

const NAV: Rect = { left: 16, top: 16, right: 560, bottom: 110 };
const SHEET: Rect = { left: 0, top: 600, right: 1200, bottom: 800 };

describe("measureMapPadding", () => {
  it("pads for the occluders inside the workspace shell only", () => {
    const shell = fakeRoot([element(NAV)]);
    const document = fakeRoot([element(NAV), element(SHEET)]);
    const container = fakeContainer(1200, 800, { shell, document });

    expect(measureMapPadding(container as unknown as HTMLElement)).toEqual(
      occluderPadding({ left: 0, top: 0, right: 1200, bottom: 800 }, [NAV]),
    );
  });

  it("falls back to the document without a shell, and to the margin without either", () => {
    const document = fakeRoot([element(SHEET)]);
    const map = { left: 0, top: 0, right: 1200, bottom: 800 };

    expect(
      measureMapPadding(fakeContainer(1200, 800, { document }) as unknown as HTMLElement),
    ).toEqual(occluderPadding(map, [SHEET]));
    expect(measureMapPadding(fakeContainer(1200, 800) as unknown as HTMLElement)).toEqual(
      occluderPadding(map, []),
    );
  });
});

describe("applyEndpointFit", () => {
  it("keeps the user's camera when both endpoints are in view", () => {
    const { map, fitBounds } = fakeMap(1200, 800);
    applyEndpointFit(map, {
      points: IN_VIEW,
      focusRequested: false,
      reduceMotion: false,
    });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("animates to an endpoint outside the view, instantly under reduced motion", () => {
    const animated = fakeMap(1200, 800);
    applyEndpointFit(animated.map, {
      points: OFF_SCREEN,
      focusRequested: false,
      reduceMotion: false,
    });
    const instant = fakeMap(1200, 800);
    applyEndpointFit(instant.map, {
      points: OFF_SCREEN,
      focusRequested: false,
      reduceMotion: true,
    });

    expect(animated.fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 600, maxZoom: 13.2 }),
    );
    expect(instant.fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 0 }),
    );
  });

  it("pads the endpoint fit for the measured overlays", () => {
    const shell = fakeRoot([element(NAV)]);
    const { map, fitBounds } = fakeMap(1200, 800, fakeContainer(1200, 800, { shell }));
    applyEndpointFit(map, {
      points: OFF_SCREEN,
      focusRequested: true,
      reduceMotion: false,
    });
    expect(fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        padding: occluderPadding({ left: 0, top: 0, right: 1200, bottom: 800 }, [NAV]),
      }),
    );
  });

  it("fits on an explicit focus request even when both endpoints are in view", () => {
    const { map, fitBounds } = fakeMap(1200, 800);
    applyEndpointFit(map, {
      points: IN_VIEW,
      focusRequested: true,
      reduceMotion: false,
    });
    expect(fitBounds).toHaveBeenCalledOnce();
  });

  it.each([
    [0, 800],
    [1200, 0],
  ])("never fits a %i x %i container", (width, height) => {
    const { map, fitBounds } = fakeMap(width, height);
    applyEndpointFit(map, {
      points: OFF_SCREEN,
      focusRequested: true,
      reduceMotion: false,
    });
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe("applyRouteFit", () => {
  const route: Array<[number, number]> = [
    [19.95, 50.05],
    [19.97, 50.07],
  ];

  it("fits the route in a sized container", () => {
    const { map, fitBounds } = fakeMap(1200, 800);
    applyRouteFit(map, route, false);
    expect(fitBounds).toHaveBeenCalledOnce();
  });

  it("keeps the route clear of the measured overlays", () => {
    const shell = fakeRoot([element(NAV), element(SHEET)]);
    const { map, fitBounds } = fakeMap(1200, 800, fakeContainer(1200, 800, { shell }));
    applyRouteFit(map, route, false);
    expect(fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        padding: occluderPadding({ left: 0, top: 0, right: 1200, bottom: 800 }, [NAV, SHEET]),
        maxZoom: 16,
      }),
    );
  });

  it.each([
    [0, 800],
    [1200, 0],
  ])("never fits a %i x %i container", (width, height) => {
    const { map, fitBounds } = fakeMap(width, height);
    applyRouteFit(map, route, false);
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe("routeFitCoordinates", () => {
  const geometry = {
    type: "LineString" as const,
    coordinates: [
      [19.9, 50.07],
      [19.91, 50.062],
    ] as [number, number][],
  };
  const incident = { lat: 50.0597, lng: 19.909 };
  const leg = { access_point: { lat: 50.062, lng: 19.91 }, distance_m: 264, seconds: 189 };

  it("frames the walk to an off-road incident with the route", () => {
    expect(
      routeFitCoordinates({ route_geometry: geometry, destination_on_foot: leg }, incident),
    ).toEqual([...geometry.coordinates, [19.909, 50.0597]]);
  });

  it("frames only the route for an on-road incident", () => {
    expect(
      routeFitCoordinates({ route_geometry: geometry, destination_on_foot: null }, incident),
    ).toEqual(geometry.coordinates);
    expect(routeFitCoordinates({ route_geometry: geometry }, null)).toEqual(geometry.coordinates);
  });
});

it("returns to the route with the same eased duration as Follow and respects reduced motion", () => {
  const { map, fitBounds } = fakeMap(1200, 800);
  applyRouteFit(map, OFF_SCREEN, false);
  expect(fitBounds).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ linear: true, duration: 600 }),
  );
  applyRouteFit(map, OFF_SCREEN, true);
  expect(fitBounds).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ linear: true, duration: 0 }),
  );
});
