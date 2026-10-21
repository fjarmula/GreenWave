import { describe, expect, it } from "vitest";
import { estimateMockRoute, haversineMeters } from "@/lib/mock-route-metrics";

const origin = { lat: 0, lng: 0 };
// 6,371 km sphere: this latitude is exactly 5,400 m from the equator.
const reference = { lat: (5400 / 6_371_000) * (180 / Math.PI), lng: 0 };

describe("endpoint-specific mock metrics", () => {
  it("retains the reference rates at density 1.5", () => {
    const metrics = estimateMockRoute(origin, reference, 1.5);
    expect(metrics.distanceMeters).toBeCloseTo(5400, 8);
    expect(metrics.normalSeconds).toBeCloseTo(780, 8);
    expect(metrics.greenwaveSeconds).toBeCloseTo(380, 8);
  });

  it("scales both times with separation and density changes only normal time", () => {
    const near = estimateMockRoute(origin, { lat: reference.lat / 2, lng: 0 }, 1.5);
    const dense = estimateMockRoute(origin, reference, 3);
    expect(near.distanceMeters).toBeCloseTo(2700, 8);
    expect(near.normalSeconds).toBeCloseTo(390, 8);
    expect(near.greenwaveSeconds).toBeCloseTo(190, 8);
    expect(dense.normalSeconds).toBeCloseTo(1560, 8);
    expect(dense.greenwaveSeconds).toBeCloseTo(380, 8);
  });

  it.each([0, 0.000000001, 0.01, 0.1])(
    "keeps distance and estimates finite at latitude %s",
    (lat) => {
      const metrics = estimateMockRoute(origin, { lat, lng: 0 }, 1);
      for (const value of Object.values(metrics)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        if (lat > 0) expect(value).toBeGreaterThan(0);
      }
      expect(haversineMeters(origin, { lat, lng: 0 })).toBeCloseTo(metrics.distanceMeters);
    },
  );
});
