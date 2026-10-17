import { describe, expect, it } from "vitest";

import {
  cancelReasonLabel,
  connectionLabel,
  describeSimulationError,
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

describe("summarizeFinishedRun", () => {
  it("compares the estimates with the simulated elapsed time and final saving", () => {
    expect(
      summarizeFinishedRun(
        { estimated_normal_time_sec: 780, estimated_greenwave_time_sec: 380 },
        { current_time_saved_sec: 396, total_time_elapsed_sec: 383 },
      ),
    ).toEqual([
      { label: "Estimated normal", value: "13m 00s" },
      { label: "Estimated GreenWave", value: "06m 20s" },
      { label: "Simulated elapsed", value: "06m 23s" },
      { label: "Final time saved", value: "06m 36s" },
    ]);
  });
});
