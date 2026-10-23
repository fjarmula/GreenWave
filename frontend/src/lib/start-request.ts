import { DEFAULT_TRAFFIC_DENSITY_MULTIPLIER } from "@/lib/mock-simulation-config";
import type { PlaybackSpeed } from "@/lib/playback-speed";
import type { Incident } from "@/lib/useIncidentDispatch";
import type {
  GreenWaveMode,
  ItsScenario,
  SimulationStartRequest,
  Station,
  VehicleType,
} from "@/types/telemetry";

export type DispatchSettings = {
  itsScenario?: ItsScenario;
  trafficDensity: number;
  cascadeEnabled: boolean;
  playbackSpeed: PlaybackSpeed;
  greenWaveMode: GreenWaveMode;
};

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  trafficDensity: DEFAULT_TRAFFIC_DENSITY_MULTIPLIER,
  cascadeEnabled: true,
  playbackSpeed: 1,
  greenWaveMode: "ENABLED",
  itsScenario: "NOMINAL",
};

/** The run goes from the chosen station to the incident; the engine itself is unchanged. */
export function buildStartRequest(
  origin: Station,
  incident: Incident,
  vehicleType: VehicleType,
  settings: DispatchSettings,
  simulationId: string,
): SimulationStartRequest {
  return {
    simulation_id: simulationId,
    origin: { lat: origin.position.lat, lng: origin.position.lng },
    destination: { lat: incident.position.lat, lng: incident.position.lng },
    traffic_density_multiplier: settings.trafficDensity,
    enable_cascade_mode: settings.cascadeEnabled,
    playback_speed: settings.playbackSpeed,
    vehicle_type: vehicleType,
    green_wave_mode: settings.greenWaveMode,
    its_scenario:
      settings.greenWaveMode === "DISABLED" ? "NOMINAL" : (settings.itsScenario ?? "NOMINAL"),
  };
}
