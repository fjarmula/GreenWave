import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import type { DispatchSettings } from "@/lib/start-request";
import type { GreenWaveMode } from "@/types/telemetry";

export type RunLabels = { origin: MapEndpoint; destination: MapEndpoint };

export function captureRunLabels(origin: MapEndpoint, destination: MapEndpoint): RunLabels {
  return {
    origin: { label: origin.label, position: { ...origin.position } },
    destination: { label: destination.label, position: { ...destination.position } },
  };
}

export function settingsForMode(settings: DispatchSettings, mode: GreenWaveMode): DispatchSettings {
  return { ...settings, greenWaveMode: mode };
}
