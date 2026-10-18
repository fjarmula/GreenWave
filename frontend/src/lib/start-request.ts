import type { DestinationEndpoint, OriginEndpoint } from "@/components/map/dispatch-endpoints";
import type { PlaybackSpeed } from "@/components/hud/dispatch/PlaybackSpeedSelector";
import type { SimulationStartRequest } from "@/types/telemetry";

export type DispatchSettings = {
  trafficDensity: number;
  cascadeEnabled: boolean;
  playbackSpeed: PlaybackSpeed;
};

export function buildStartRequest(
  origin: OriginEndpoint,
  destination: DestinationEndpoint,
  settings: DispatchSettings,
  simulationId: string,
): SimulationStartRequest {
  return {
    simulation_id: simulationId,
    origin: { lng: origin.coordinates[0], lat: origin.coordinates[1] },
    destination: { lng: destination.coordinates[0], lat: destination.coordinates[1] },
    traffic_density_multiplier: settings.trafficDensity,
    enable_cascade_mode: settings.cascadeEnabled,
    playback_speed: settings.playbackSpeed,
  };
}
