import { expect, it } from "vitest";

import { buildStartRequest } from "@/lib/start-request";
import type { Station } from "@/types/telemetry";

const STATION: Station = {
  station_id: "STN-F-0011",
  vehicle_type: "FIRE_TRUCK",
  source_kind: "fire_state",
  name: "JRG 1",
  position: { lat: 50.05, lng: 19.95 },
};

it("starts at the station and ends at the incident with the vehicle type", () => {
  const request = buildStartRequest(
    STATION,
    { position: { lat: 50.0617, lng: 19.9373 }, label: "Rynek Główny 1", source: "address" },
    "FIRE_TRUCK",
    { trafficDensity: 2.3, cascadeEnabled: false, playbackSpeed: 5, greenWaveMode: "ENABLED" },
    "SIM-1",
  );

  expect(request).toEqual({
    simulation_id: "SIM-1",
    origin: { lat: 50.05, lng: 19.95 },
    destination: { lat: 50.0617, lng: 19.9373 },
    traffic_density_multiplier: 2.3,
    enable_cascade_mode: false,
    playback_speed: 5,
    vehicle_type: "FIRE_TRUCK",
    green_wave_mode: "ENABLED",
    its_scenario: "NOMINAL" as const,
    its_outcome_seed: 0,
  });
});

it("sends the selected ER Green Wave mode", () => {
  const request = buildStartRequest(
    STATION,
    { position: { lat: 50.0617, lng: 19.9373 }, label: "Rynek Główny 1", source: "address" },
    "AMBULANCE",
    { trafficDensity: 1.5, cascadeEnabled: true, playbackSpeed: 1, greenWaveMode: "DISABLED" },
    "SIM-2",
  );

  expect(request.green_wave_mode).toBe("DISABLED");
  expect(request.enable_cascade_mode).toBe(true); // kept for the wire; ignored when disabled
});
