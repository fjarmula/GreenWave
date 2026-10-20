import type { Station, StationSourceKind, VehicleType } from "@/types/telemetry";

export type StationRole = "chosen" | "runner_up" | "other";

export type StationFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    station_id: string;
    name: string;
    vehicle_type: VehicleType;
    source_kind: StationSourceKind;
    /** Another vehicle type than the selected one. */
    dimmed: boolean;
    role: StationRole;
  };
};

export type StationFeatureCollection = { type: "FeatureCollection"; features: StationFeature[] };

/** Map features for every station: other types dimmed, the chosen one and runners-up marked. */
export function stationFeatures(
  stations: Station[],
  selected: VehicleType,
  chosenId: string | null,
  runnerUpIds: string[],
): StationFeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [station.position.lng, station.position.lat] },
      properties: {
        station_id: station.station_id,
        name: station.name,
        vehicle_type: station.vehicle_type,
        source_kind: station.source_kind,
        dimmed: station.vehicle_type !== selected,
        role:
          station.station_id === chosenId
            ? "chosen"
            : runnerUpIds.includes(station.station_id)
              ? "runner_up"
              : "other",
      },
    })),
  };
}
