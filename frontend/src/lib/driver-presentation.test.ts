import { describe, expect, it } from "vitest";
import {
  etaSeconds,
  formatSignalDistance,
  nextSignal,
  nextSignalCopy,
  savedPill,
  settingsSummary,
} from "./driver-presentation";
import {
  startResponseExample,
  tickEventExample,
} from "@/lib/transport/__fixtures__/architecture-examples";
import type {
  IntersectionTelemetry,
  SimulationStartResponse,
  SimulationTickEvent,
} from "@/types/telemetry";

const [first, second] = startResponseExample.route_intersections;
const route: SimulationStartResponse = {
  ...startResponseExample,
  // A straight east-west route, so distances are easy to reason about.
  route_geometry: {
    type: "LineString",
    coordinates: [
      [19.9, 50.0],
      [19.95, 50.0],
    ],
  },
  route_intersections: [
    { ...first, id: "INT-A", name: "Alpha", distance_along_route_m: 184 },
    { ...second, id: "INT-B", name: null, distance_along_route_m: 1234 },
  ],
};
const telemetry = (id: string, state: IntersectionTelemetry["state"], tti: number | null) => ({
  ...tickEventExample.intersections[0],
  id,
  state,
  tti_seconds: tti,
});
const tickAt = (intersections: IntersectionTelemetry[], elapsed = 42): SimulationTickEvent => ({
  ...tickEventExample,
  ambulance: { ...tickEventExample.ambulance, position: { lat: 50.0, lng: 19.9 } },
  kpi_metrics: { ...tickEventExample.kpi_metrics, total_time_elapsed_sec: elapsed },
  intersections,
});

describe("nextSignal", () => {
  it("is the first route intersection still ahead", () => {
    const tick = tickAt([
      telemetry("INT-A", "PRIORITY_GREEN", 9),
      telemetry("INT-B", "CLEARING", 60),
    ]);
    expect(nextSignal(route, tick, false)).toEqual({
      intersectionId: "INT-A",
      name: "Alpha",
      state: "PRIORITY_GREEN",
      distanceM: 184,
    });
  });
  it("skips passed intersections", () => {
    const tick = tickAt([telemetry("INT-A", "RECOVERY", null), telemetry("INT-B", "CLEARING", 60)]);
    expect(nextSignal(route, tick, false)?.intersectionId).toBe("INT-B");
  });
  it("no next signal without fresh telemetry", () => {
    const tick = tickAt([telemetry("INT-A", "PRIORITY_GREEN", 9)]);
    expect(nextSignal(route, tick, true)).toBeNull();
    expect(nextSignal(route, null, false)).toBeNull();
  });
  it("is null when the vehicle is already past it", () => {
    const tick = tickAt([telemetry("INT-A", "PRIORITY_GREEN", 9)]);
    const past = { ...tick, ambulance: { ...tick.ambulance, position: { lat: 50.0, lng: 19.91 } } };
    expect(nextSignal(route, past, false)).toBeNull();
  });
  it("is null when nothing is ahead", () => {
    expect(nextSignal(route, tickAt([telemetry("INT-A", "NORMAL", null)]), false)).toBeNull();
  });
});

describe("copy", () => {
  it("formats distances", () => {
    expect(formatSignalDistance(184)).toBe("180 m");
    expect(formatSignalDistance(1234)).toBe("1.2 km");
    expect(formatSignalDistance(996)).toBe("1.0 km");
  });
  it("names the signal state", () => {
    const signal = { intersectionId: "INT-A", name: null, distanceM: 184 };
    expect(nextSignalCopy({ ...signal, state: "PRIORITY_GREEN" })).toBe("Green in 180 m");
    expect(nextSignalCopy({ ...signal, state: "CLEARING" })).toBe("Clearing in 180 m");
    expect(nextSignalCopy({ ...signal, state: "NORMAL" })).toBe("Red in 180 m");
    expect(nextSignalCopy({ ...signal, state: "RECOVERY" })).toBe("Red in 180 m");
  });
  it("labels time against the estimate", () => {
    expect(savedPill(41)).toBe("41 s faster · simulated");
    expect(savedPill(-5)).toBe("5 s slower · simulated");
    expect(savedPill(0)).toBe("On estimate · simulated");
  });
  it("summarises dispatch settings", () => {
    expect(
      settingsSummary({
        trafficDensity: 1.5,
        cascadeEnabled: true,
        playbackSpeed: 1,
        greenWaveMode: "ENABLED",
      }),
    ).toBe("Traffic 1.5× · Cascade on · 1× speed");
    expect(
      settingsSummary({
        trafficDensity: 1,
        cascadeEnabled: false,
        playbackSpeed: 10,
        greenWaveMode: "ENABLED",
      }),
    ).toBe("Traffic 1× · Cascade off · 10× speed");
  });
});

describe("etaSeconds", () => {
  it("counts down the Green Wave estimate", () => {
    expect(etaSeconds(route, tickAt([], 80))).toBe(300);
    expect(etaSeconds(route, null)).toBe(380);
  });
  it("uses the normal estimate for standard traffic and never goes negative", () => {
    expect(etaSeconds({ ...route, green_wave_mode: "DISABLED" }, tickAt([], 80))).toBe(700);
    expect(etaSeconds(route, tickAt([], 999))).toBe(0);
  });
});
