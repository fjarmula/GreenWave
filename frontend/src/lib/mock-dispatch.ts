/**
 * Mock dispatch (no backend): straight-line nearest station of the requested type
 * from the committed snapshot (`backend/scripts/export_station_snapshot.py`). It has
 * no road times and no address search; the UI labels its choice "Approximate (mock)".
 */
import snapshot from "@/data/stations.snapshot.json";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { SimulationAdapterError } from "@/lib/transport/errors";
import { validateStations } from "@/lib/transport/validate";
import { haversineMeters } from "@/lib/mock-route-metrics";
import type { Station } from "@/types/telemetry";

export { haversineMeters } from "@/lib/mock-route-metrics";

export function createMockDispatchAdapter(
  stations: Station[] = validateStations(snapshot).stations,
): DispatchAdapter {
  return {
    capabilities: { geocode: false, roadTimeRanking: false },

    async listStations() {
      return stations;
    },

    async geocode() {
      throw new Error("Address search needs the backend");
    },

    async rank({ incident, vehicle_type }) {
      const ranked = stations
        .filter((station) => station.vehicle_type === vehicle_type)
        .map((station) => ({ station, distance: haversineMeters(incident, station.position) }))
        .sort(
          (a, b) =>
            a.distance - b.distance || a.station.station_id.localeCompare(b.station.station_id),
        );
      const stationAtIncident = ranked.find((item) => item.distance === 0)?.station ?? null;
      const nearest = ranked.find((item) => item.distance > 0);
      if (!nearest) {
        throw new SimulationAdapterError({
          kind: "http",
          code: "NO_STATION_REACHABLE",
          message: "No station of this type can reach this location",
        });
      }
      return {
        schema_version: "1.0",
        incident_snapped: { position: incident, snap_distance_m: 0 },
        candidates: [
          {
            station: nearest.station,
            greenwave_seconds: 0,
            standard_seconds: 0,
            distance_m: nearest.distance,
          },
        ],
        station_at_incident: stationAtIncident,
      };
    },
  };
}
