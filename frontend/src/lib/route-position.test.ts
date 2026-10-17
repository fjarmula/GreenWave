import { describe, expect, it } from "vitest";
import {
  distanceAlongRoute,
  interpolateAlongRoute,
  pointAtDistance,
  positionOnRoute,
} from "@/lib/route-position";
import type { RouteGeometry } from "@/types/telemetry";

const route: RouteGeometry = {
  type: "LineString",
  coordinates: [
    [19, 50],
    [20, 50],
    [20, 51],
  ],
};
describe("mock route positions", () => {
  it("interpolates along segments and preserves corners", () => {
    expect(positionOnRoute(route, 0.25)).toEqual([19.5, 50]);
    expect(positionOnRoute(route, 0.5)).toEqual([20, 50]);
    expect(positionOnRoute(route, 0.75)).toEqual([20, 50.5]);
  });
  it("clamps progress to route endpoints", () => {
    expect(positionOnRoute(route, -1)).toEqual([19, 50]);
    expect(positionOnRoute(route, 2)).toEqual([20, 51]);
  });
  it("does not fabricate a position for missing route geometry", () => {
    expect(positionOnRoute({ type: "LineString", coordinates: [] }, 0)).toBeNull();
    expect(positionOnRoute({ type: "LineString", coordinates: [[19, 50]] }, 0)).toBeNull();
  });
});

// A short L-shaped street corner in Kraków: east ~143 m, then north ~111 m.
const corner: RouteGeometry = {
  type: "LineString",
  coordinates: [
    [19.93, 50.06],
    [19.932, 50.06],
    [19.932, 50.061],
  ],
};

function close(actual: [number, number] | null, expected: [number, number], digits = 6) {
  expect(actual).not.toBeNull();
  expect(actual?.[0]).toBeCloseTo(expected[0], digits);
  expect(actual?.[1]).toBeCloseTo(expected[1], digits);
}

describe("polyline distance helpers", () => {
  it("projects a point onto the route as metres from the start", () => {
    expect(distanceAlongRoute(corner, [19.93, 50.06])).toBeCloseTo(0, 3);
    const bend = distanceAlongRoute(corner, [19.932, 50.06]) ?? 0;
    expect(bend).toBeGreaterThan(140);
    expect(bend).toBeLessThan(146);
    // A point slightly off the second leg projects onto it.
    const onSecondLeg = distanceAlongRoute(corner, [19.93205, 50.0605]) ?? 0;
    expect(onSecondLeg).toBeGreaterThan(bend);
  });

  it("maps a distance back to a point and clamps to the ends", () => {
    const bend = distanceAlongRoute(corner, [19.932, 50.06]) ?? 0;
    close(pointAtDistance(corner, bend), [19.932, 50.06]);
    close(pointAtDistance(corner, -5), [19.93, 50.06]);
    close(pointAtDistance(corner, 1e6), [19.932, 50.061]);
  });

  it("returns null without a usable route", () => {
    const empty: RouteGeometry = { type: "LineString", coordinates: [[19, 50]] };
    expect(distanceAlongRoute(empty, [19, 50])).toBeNull();
    expect(pointAtDistance(empty, 0)).toBeNull();
  });
});

describe("interpolateAlongRoute", () => {
  it("follows the bend instead of cutting the corner with a chord", () => {
    const from: [number, number] = [19.931, 50.06]; // middle of the first leg
    const to: [number, number] = [19.932, 50.0605]; // middle of the second leg
    const halfway = interpolateAlongRoute(corner, from, to, 0.5);
    // The chord midpoint (19.9315, 50.06025) is off the road; the route point lies on a leg.
    expect(halfway).not.toBeNull();
    const [lng, lat] = halfway ?? [0, 0];
    const onFirstLeg = Math.abs(lat - 50.06) < 1e-9;
    const onSecondLeg = Math.abs(lng - 19.932) < 1e-9;
    expect(onFirstLeg || onSecondLeg).toBe(true);
  });

  it("returns the endpoints at fraction 0 and 1", () => {
    const from: [number, number] = [19.931, 50.06];
    const to: [number, number] = [19.932, 50.0605];
    close(interpolateAlongRoute(corner, from, to, 0), from);
    close(interpolateAlongRoute(corner, from, to, 1), to);
  });

  it("falls back to a straight line without a route", () => {
    expect(interpolateAlongRoute(null, [19, 50], [20, 50], 0.5)).toEqual([19.5, 50]);
  });
});
