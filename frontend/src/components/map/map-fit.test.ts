import type { Map } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { applyEndpointFit } from "@/components/map/endpoint-fit";
import { applyRouteFit } from "@/components/map/useRouteFit";

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

/** Only what the fit helpers touch: container size, current view, and fitBounds. */
function fakeMap(width: number, height: number) {
  const fitBounds = vi.fn();
  const map = {
    getContainer: () => ({ clientWidth: width, clientHeight: height }),
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

describe("applyEndpointFit", () => {
  it("keeps the user's camera when both endpoints are in view", () => {
    const { map, fitBounds } = fakeMap(1200, 800);
    applyEndpointFit(map, {
      points: IN_VIEW,
      live: false,
      focusRequested: false,
      reduceMotion: false,
    });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("animates to an endpoint outside the view, instantly under reduced motion", () => {
    const animated = fakeMap(1200, 800);
    applyEndpointFit(animated.map, {
      points: OFF_SCREEN,
      live: false,
      focusRequested: false,
      reduceMotion: false,
    });
    const instant = fakeMap(1200, 800);
    applyEndpointFit(instant.map, {
      points: OFF_SCREEN,
      live: false,
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

  it("fits on an explicit focus request even when both endpoints are in view", () => {
    const { map, fitBounds } = fakeMap(1200, 800);
    applyEndpointFit(map, {
      points: IN_VIEW,
      live: false,
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
      live: false,
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

  it.each([
    [0, 800],
    [1200, 0],
  ])("never fits a %i x %i container", (width, height) => {
    const { map, fitBounds } = fakeMap(width, height);
    applyRouteFit(map, route, false);
    expect(fitBounds).not.toHaveBeenCalled();
  });
});
