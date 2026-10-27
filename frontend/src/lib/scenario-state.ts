import type { MapEndpoint } from "@/components/map/EndpointMarkers";
import type { DispatchSettings } from "@/lib/start-request";
import type { GreenWaveMode } from "@/types/telemetry";

export type RunLabels = { origin: MapEndpoint; destination: MapEndpoint };

function copyEndpoint(endpoint: MapEndpoint): MapEndpoint {
  const copy: MapEndpoint = { label: endpoint.label, position: { ...endpoint.position } };
  if (endpoint.osmPosition) copy.osmPosition = { ...endpoint.osmPosition };
  return copy;
}

export function captureRunLabels(origin: MapEndpoint, destination: MapEndpoint): RunLabels {
  return { origin: copyEndpoint(origin), destination: copyEndpoint(destination) };
}

export function settingsForMode(settings: DispatchSettings, mode: GreenWaveMode): DispatchSettings {
  return { ...settings, greenWaveMode: mode };
}
