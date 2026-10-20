/**
 * Mock dispatch (no backend): straight-line nearest station of the requested type
 * from the committed snapshot (`backend/scripts/export_station_snapshot.py`). It has
 * no road times and no address search; the UI labels its choice "Approximate (mock)".
 */
import snapshot from "@/data/stations.snapshot.json";
import type { DispatchAdapter } from "@/lib/dispatch-adapter";
import { SimulationAdapterError } from "@/lib/transport/errors";
import { validateStations } from "@/lib/transport/validate";
import type { Position, Station } from "@/types/telemetry";

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

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
      const nearest = stations
        .filter((station) => station.vehicle_type === vehicle_type)
        .map((station) => ({ station, distance: haversineMeters(incident, station.position) }))
        .sort(
          (a, b) =>
            a.distance - b.distance || a.station.station_id.localeCompare(b.station.station_id),
        )[0];
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
          { station: nearest.station, greenwave_seconds: 0, distance_m: nearest.distance },
        ],
        station_at_incident: null,
      };
    },
  };
}
