import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VehicleTelemetry } from "@/components/dashboard/VehicleTelemetry";
import { initialSimulationState, type SimulationState } from "@/lib/simulation-state";
import type { SimulationStartRequest, VehicleType } from "@/types/telemetry";

let state: SimulationState = initialSimulationState;
vi.mock("@/components/simulation-provider", () => ({ useSimulationState: () => state }));

function running(vehicleType: VehicleType): SimulationState {
  const startRequest: SimulationStartRequest = {
    simulation_id: "SIM-vehicle",
    origin: { lat: 50.05, lng: 19.95 },
    destination: { lat: 50.06, lng: 19.94 },
    traffic_density_multiplier: 1.5,
    enable_cascade_mode: true,
    playback_speed: 1,
    vehicle_type: vehicleType,
    green_wave_mode: "ENABLED",
    its_scenario: "NOMINAL" as const,
  };
  return { ...initialSimulationState, simulationState: "RUNNING", startRequest };
}

describe("VehicleTelemetry vehicle type", () => {
  beforeEach(() => {
    state = initialSimulationState;
  });

  it.each([
    ["FIRE_TRUCK", "Fire truck", "lucide-flame-kindling"],
    ["POLICE_CAR", "Police car", "lucide-siren"],
    ["AMBULANCE", "Ambulance", "lucide-ambulance"],
  ] as const)("names a %s run %s with its icon", (type, label, icon) => {
    state = running(type);
    const markup = renderToStaticMarkup(<VehicleTelemetry />);

    expect(markup).toContain(`>${label}</p>`);
    expect(markup).toContain(icon);
    expect(markup).not.toContain("Priority vehicle");
  });

  it("falls back to the ambulance before a run", () => {
    const markup = renderToStaticMarkup(<VehicleTelemetry />);

    expect(markup).toContain(">Ambulance</p>");
    expect(markup).toContain("lucide-ambulance");
  });
});
