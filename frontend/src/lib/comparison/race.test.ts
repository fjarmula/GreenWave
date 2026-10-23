import { describe, expect, it } from "vitest";
import { comparisonResult, raceReadout, raceStanding, type ComparisonMode } from "./race";
import { completed, request, route, tick } from "./fixtures.test-support";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";

// A straight east-west route of about 3.58 km.
const line = {
  ...route("pair-e"),
  route_geometry: {
    type: "LineString" as const,
    coordinates: [
      [19.9, 50.0],
      [19.95, 50.0],
    ] as [number, number][],
  },
};
const metresPerDegree = 3579 / 0.05;
const at = (metres: number, mode: ComparisonMode, n = 10): SimulationState => ({
  ...initialSimulationState,
  simulationState: "RUNNING",
  startRequest: { ...request, green_wave_mode: mode },
  routeData: line,
  lastTick: n,
  liveTelemetry: {
    ...tick(n),
    ambulance: {
      ...tick(n).ambulance,
      position: { lat: 50.0, lng: 19.9 + metres / metresPerDegree },
    },
  },
});
const arrived = (mode: ComparisonMode, seconds: number): SimulationState => ({
  ...at(3579, mode, seconds),
  simulationState: "FINISHED",
  completion: completed(seconds),
});
const standing = (enabled: SimulationState, disabled: SimulationState) =>
  raceStanding(line, { ENABLED: enabled, DISABLED: disabled });

describe("raceStanding", () => {
  it("measures the Green Wave lead along the route", () => {
    const result = standing(at(1500, "ENABLED"), at(800, "DISABLED"));
    expect(result.leader).toBe("ENABLED");
    expect(result.leadM).toBeCloseTo(700, -1);
    expect(result.positions.ENABLED).toBeCloseTo(1500 / 3579, 2);
    expect(result.arrived).toBeNull();
  });
  it("lets standard traffic lead", () => {
    const result = standing(at(300, "ENABLED"), at(420, "DISABLED"));
    expect(result.leader).toBe("DISABLED");
    expect(raceReadout(result)).toBe("Standard traffic ahead by 120 m");
  });
  it("is level under 10 m", () => {
    expect(standing(at(500, "ENABLED"), at(505, "DISABLED")).leader).toBe("LEVEL");
    expect(raceReadout(standing(at(500, "ENABLED"), at(505, "DISABLED")))).toBe("Level");
  });
  it("starts level before any telemetry", () => {
    const idle = { ...initialSimulationState };
    expect(standing(idle, idle)).toMatchObject({ leader: "LEVEL", leadM: 0 });
  });
  it("names the first arrival", () => {
    const result = standing(arrived("ENABLED", 300), at(3179, "DISABLED"));
    expect(result.arrived).toBe("ENABLED");
    expect(raceReadout(result)).toBe("Green Wave arrived · standard traffic 400 m behind");
    expect(raceReadout(standing(at(2879, "ENABLED"), arrived("DISABLED", 280)))).toBe(
      "Standard traffic arrived · Green Wave 700 m behind",
    );
  });
  it("reads both arrived once the race is over", () => {
    expect(raceReadout(standing(arrived("ENABLED", 300), arrived("DISABLED", 345)))).toBe(
      "Both arrived",
    );
  });
  it("reads the lead with the signal-distance rules", () => {
    expect(raceReadout(standing(at(1500, "ENABLED"), at(800, "DISABLED")))).toBe(
      "Green Wave ahead by 700 m",
    );
    expect(raceReadout(standing(at(2900, "ENABLED"), at(1600, "DISABLED")))).toBe(
      "Green Wave ahead by 1.3 km",
    );
  });
  it("stale side freezes in the readout", () => {
    // A stale run keeps its last telemetry, so its position does not move.
    const stale = { ...at(800, "DISABLED"), connection: "reconnecting" as const };
    const first = standing(at(1000, "ENABLED"), stale);
    const later = standing(at(1400, "ENABLED"), stale);
    expect(later.positions.DISABLED).toBe(first.positions.DISABLED);
  });
});

describe("comparisonResult", () => {
  it("is null until both runs completed", () => {
    expect(
      comparisonResult(
        { ENABLED: arrived("ENABLED", 300), DISABLED: at(3000, "DISABLED") },
        [],
        line,
      ),
    ).toBeNull();
  });
  it("reports both times, the difference and prioritised signals", () => {
    const result = comparisonResult(
      { ENABLED: arrived("ENABLED", 300), DISABLED: arrived("DISABLED", 345) },
      ["INT-0360", "INT-0360", "INT-0366"],
      line,
    );
    expect(result).toEqual({
      enabledSeconds: 300,
      disabledSeconds: 345,
      delta: 45,
      label: "Green Wave faster",
      prioritised: 2,
      total: 2,
    });
  });
  it("labels a standard-traffic win and a tie neutrally", () => {
    const slower = comparisonResult(
      { ENABLED: arrived("ENABLED", 310), DISABLED: arrived("DISABLED", 300) },
      [],
      line,
    );
    expect(slower).toMatchObject({ delta: -10, label: "standard traffic faster", prioritised: 0 });
    const same = comparisonResult(
      { ENABLED: arrived("ENABLED", 300), DISABLED: arrived("DISABLED", 300) },
      [],
      line,
    );
    expect(same?.label).toBe("same travel time");
  });
});
