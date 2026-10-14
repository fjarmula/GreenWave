import { describe, expect, it } from "vitest";
import { positionOnRoute } from "@/lib/route-position";
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
