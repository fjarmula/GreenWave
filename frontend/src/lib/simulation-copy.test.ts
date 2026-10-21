import { describe, expect, it } from "vitest";

import {
  cancelReasonLabel,
  connectionLabel,
  describeSimulationError,
  formatDuration,
  formatSignedSeconds,
  greenWaveModeLabel,
  summarizeFinishedRun,
} from "@/lib/simulation-copy";

const API = "http://127.0.0.1:8000";

describe("describeSimulationError", () => {
  it.each([
    ["ORIGIN_OFF_NETWORK", 422, "Origin is not on the simulated road network"],
    ["DESTINATION_OFF_NETWORK", 422, "Destination is not on the simulated road network"],
    ["NO_ROUTE", 422, "No drivable route between these points"],
    ["SIMULATION_NOT_FOUND", 404, "Simulation no longer exists"],
    [
      "SIMULATION_ID_IN_USE",
      409,
      "The simulation id was already in use twice; please initialize again",
    ],
  ] as const)("maps %s", (code, status, text) => {
    expect(describeSimulationError({ kind: "http", status, code, message: "raw" }, API)).toBe(text);
  });

  it("says a slow backend did not answer, instead of calling it unreachable", () => {
    expect(
      describeSimulationError(
        { kind: "network", reason: "timeout", message: "Simulation backend at X did not answer" },
        API,
      ),
    ).toBe("Simulation backend at http://127.0.0.1:8000 did not answer in time");
  });

  it("names the backend URL for network failures", () => {
    expect(describeSimulationError({ kind: "network", message: "timeout" }, API)).toBe(
      "Simulation backend unreachable at http://127.0.0.1:8000",
    );
  });

  it("falls back to the HTTP status when there is no contract error code", () => {
    expect(describeSimulationError({ kind: "http", status: 422, message: "raw" }, API)).toBe(
      "The simulation backend rejected the request (HTTP 422)",
    );
    expect(describeSimulationError({ kind: "http", message: "raw" }, API)).toBe(
      "The simulation backend sent an unexpected response",
    );
  });
});

describe("labels", () => {
  it("labels every connection status", () => {
    expect(connectionLabel("open")).toBe("Live");
    expect(connectionLabel("connecting")).toBe("Connecting…");
    expect(connectionLabel("reconnecting")).toBe("Reconnecting…");
    expect(connectionLabel("lost")).toBe("Connection lost");
  });

  it("labels cancel reasons", () => {
    expect(cancelReasonLabel("STOPPED")).toBe("Stopped");
    expect(cancelReasonLabel("SUPERSEDED")).toBe("Superseded by another dispatch");
  });
});

describe("signed durations", () => {
  it("formats negative time saved with a minus sign instead of clamping", () => {
    expect(formatDuration(-3)).toBe("−00m 03s");
    expect(formatSignedSeconds(145)).toBe("+145s");
    expect(formatSignedSeconds(-3)).toBe("−3s");
    expect(formatSignedSeconds(0)).toBe("+0s");
  });
});

describe("greenWaveModeLabel", () => {
  it("names both modes", () => {
    expect(greenWaveModeLabel("ENABLED")).toBe("ER Green Wave enabled");
    expect(greenWaveModeLabel("DISABLED")).toBe("ER Green Wave disabled");
  });
});

describe("summarizeFinishedRun", () => {
  it("leads with total travel time and names the enabled mode", () => {
    expect(
      summarizeFinishedRun(
        {
          estimated_normal_time_sec: 780,
          estimated_greenwave_time_sec: 380,
          green_wave_mode: "ENABLED",
        },
        { current_time_saved_sec: 396, total_time_elapsed_sec: 383 },
      ),
    ).toEqual([
      { label: "Total travel time", value: "06m 23s" },
      { label: "ER Green Wave", value: "Enabled" },
      { label: "Normal-traffic estimate", value: "13m 00s" },
      { label: "GreenWave estimate", value: "06m 20s" },
      { label: "Saved vs normal-traffic estimate", value: "06m 36s" },
    ]);
  });

  it("does not present a GreenWave estimate for a disabled run", () => {
    const summary = summarizeFinishedRun(
      {
        estimated_normal_time_sec: 780,
        estimated_greenwave_time_sec: 380,
        green_wave_mode: "DISABLED",
      },
      { current_time_saved_sec: 260, total_time_elapsed_sec: 520 },
    );

    expect(summary).toEqual([
      { label: "Total travel time", value: "08m 40s" },
      { label: "ER Green Wave", value: "Disabled" },
      { label: "Normal-traffic estimate", value: "13m 00s" },
      { label: "Saved vs normal-traffic estimate", value: "04m 20s" },
    ]);
    expect(summary.some(({ label }) => /greenwave/i.test(label))).toBe(false);
  });
});
