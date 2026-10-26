import { describe, expect, it } from "vitest";
import {
  LOOP_MS,
  corridor,
  corridorSnapshot,
  REDUCED_PROGRESS,
  corridorProgress,
  pointAlong,
  signalState,
} from "@/lib/home-corridor";

describe("corridorProgress", () => {
  it("loops over LOOP_MS and holds a still frame under reduced motion", () => {
    expect(corridorProgress(0, false)).toBe(0);
    expect(corridorProgress(LOOP_MS * 1.5, false)).toBe(0.5);
    expect(corridorProgress(123, true)).toBe(REDUCED_PROGRESS);
  });
});

describe("signalState", () => {
  it("turns green shortly before the vehicle and idles once it passed", () => {
    expect(signalState(0.5, 0.4)).toBe("green");
    expect(signalState(0.5, 0.3)).toBe("ahead");
    expect(signalState(0.5, 0.56)).toBe("passed");
  });
});

describe("pointAlong", () => {
  const line: [number, number][] = [
    [0, 0],
    [0, 1],
  ];
  it("places the vehicle by route share and trails it", () => {
    const { point, trail } = pointAlong(line, 0.5);
    expect(point[0]).toBeCloseTo(0, 6);
    expect(point[1]).toBeCloseTo(0.5, 6);
    expect(trail[0][1]).toBeCloseTo(0.28, 6);
    expect(trail[trail.length - 1]).toEqual(point);
  });
  it("keeps a trail at the start of the route", () => {
    expect(pointAlong(line, 0).trail.length).toBeGreaterThanOrEqual(1);
  });
});

describe("corridorSnapshot", () => {
  it("gives one frame's vehicle, trail and signal states for any progress", () => {
    const frame = corridorSnapshot(REDUCED_PROGRESS);
    expect(frame.point).toEqual(pointAlong(corridor.route.lonLat, REDUCED_PROGRESS).point);
    expect(frame.states).toHaveLength(corridor.signals.length);
    expect(frame.states).toContain("green");
  });
});
