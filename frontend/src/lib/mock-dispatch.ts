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

/** Naive local "YYYY-MM-DDTHH:MM:00", the shape the backend echoes as scenario_time. */
function localMinute(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

export function createMockDispatchAdapter(
  stations: Station[] = validateStations(snapshot).stations,
): DispatchAdapter {
  return {
    capabilities: { geocode: false, roadTimeRanking: false, resources: false },

    async listStations() {
      return stations;
    },

    async listResources() {
      throw new Error("The PRM team roster needs the backend");
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
      // A station at the incident answers on site (ADR 0012): no drive, a 0 m walk.
      const onSite = ranked.filter((item) => item.distance === 0);
      const nearest = ranked.find((item) => item.distance > 0);
      if (!onSite.length && !nearest) {
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
          ...onSite.map(({ station }) => ({
            station,
            greenwave_seconds: 0,
            standard_seconds: 0,
            distance_m: 0,
            on_foot: { access_point: station.position, distance_m: 0, seconds: 0 },
            on_site: true,
          })),
          ...(nearest
            ? [
                {
                  station: nearest.station,
                  greenwave_seconds: 0,
                  standard_seconds: 0,
                  distance_m: nearest.distance,
                  on_site: false,
                },
              ]
            : []),
        ].slice(0, 3),
        // No roster in mock mode (capability resources: false): plain nearest station.
        scenario_time: localMinute(new Date()),
        outcome: "OK",
        incident_area: null,
        excluded_teams: [],
        roster: null,
        area_rule: null,
      };
    },
  };
}
