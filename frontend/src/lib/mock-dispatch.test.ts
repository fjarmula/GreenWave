import { describe, expect, it } from "vitest";

import { SimulationAdapterError } from "@/lib/transport/errors";
import { createMockDispatchAdapter, haversineMeters } from "@/lib/mock-dispatch";
import type { Station } from "@/types/telemetry";

const station = (
  station_id: string,
  vehicle_type: Station["vehicle_type"],
  lat: number,
  lng: number,
): Station => ({
  station_id,
  vehicle_type,
  source_kind: vehicle_type === "AMBULANCE" ? "ambulance_base" : "fire_state",
  name: station_id,
  position: { lat, lng },
});

const STATIONS = [
  station("STN-A-0001", "AMBULANCE", 50.0, 19.9),
  station("STN-A-0002", "AMBULANCE", 50.06, 19.94),
  station("STN-F-0001", "FIRE_TRUCK", 50.061, 19.937),
];

describe("haversineMeters", () => {
  it("measures about 111 km per degree of latitude", () => {
    expect(haversineMeters({ lat: 50, lng: 19.9 }, { lat: 51, lng: 19.9 })).toBeCloseTo(
      111_195,
      -2,
    );
  });
});

describe("createMockDispatchAdapter", () => {
  const adapter = createMockDispatchAdapter(STATIONS);
  const incident = { lat: 50.0617, lng: 19.9373 };

  it("offers neither geocoding nor road-time ranking", () => {
    expect(adapter.capabilities).toEqual({ geocode: false, roadTimeRanking: false });
  });

  it("lists the injected stations", async () => {
    await expect(adapter.listStations()).resolves.toEqual(STATIONS);
  });

  it("picks the straight-line nearest station of the requested type", async () => {
    const ambulance = await adapter.rank({
      incident,
      vehicle_type: "AMBULANCE",
      traffic_density_multiplier: 1,
      time_mode: "ENABLED",
      availability: {},
    });
    const fire = await adapter.rank({
      incident,
      vehicle_type: "FIRE_TRUCK",
      traffic_density_multiplier: 1,
      time_mode: "ENABLED",
      availability: {},
    });

    expect(ambulance.candidates.map((c) => c.station.station_id)).toEqual(["STN-A-0002"]);
    expect(fire.candidates.map((c) => c.station.station_id)).toEqual(["STN-F-0001"]);
    expect(ambulance.candidates[0].greenwave_seconds).toBe(0);
    expect(ambulance.candidates[0].standard_seconds).toBe(0);
    expect(ambulance.candidates[0].distance_m).toBeCloseTo(
      haversineMeters(incident, STATIONS[1].position),
    );
    expect(ambulance.incident_snapped).toEqual({ position: incident, snap_distance_m: 0 });
    expect(ambulance.station_at_incident).toBeNull();
    expect(ambulance.schema_version).toBe("1.0");
  });

  it("rejects with NO_STATION_REACHABLE when no station has the type", async () => {
    const error = await adapter
      .rank({
        incident,
        vehicle_type: "POLICE_CAR",
        traffic_density_multiplier: 1,
        time_mode: "ENABLED",
        availability: {},
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(SimulationAdapterError);
    expect(error.code).toBe("NO_STATION_REACHABLE");
  });

  it("rejects address search", async () => {
    await expect(adapter.geocode("Floriańska 1")).rejects.toThrow();
  });

  it("defaults to the committed station snapshot", async () => {
    const stations = await createMockDispatchAdapter().listStations();
    expect(stations.length).toBeGreaterThan(0);
    expect(new Set(stations.map((s) => s.vehicle_type))).toEqual(
      new Set(["AMBULANCE", "FIRE_TRUCK", "POLICE_CAR"]),
    );
  });
});

describe("coincident station dispatch", () => {
  it("answers from the coincident station on site, then the next distinct station", async () => {
    const adapter = createMockDispatchAdapter(STATIONS);
    const result = await adapter.rank({
      incident: STATIONS[1].position,
      vehicle_type: "AMBULANCE",
      traffic_density_multiplier: 1,
      time_mode: "ENABLED",
      availability: {},
    });
    expect(result.station_at_incident).toBeNull();
    expect(result.candidates.map((item) => [item.station.station_id, item.on_site])).toEqual([
      [STATIONS[1].station_id, true],
      ["STN-A-0001", false],
    ]);
    expect(result.candidates[0].on_foot).toEqual({
      access_point: STATIONS[1].position,
      distance_m: 0,
      seconds: 0,
    });
    expect(result.candidates[1].distance_m).toBeGreaterThan(0);
  });

  it("answers on site when the only station is coincident", async () => {
    const adapter = createMockDispatchAdapter([STATIONS[0]]);
    const result = await adapter.rank({
      incident: STATIONS[0].position,
      vehicle_type: "AMBULANCE",
      traffic_density_multiplier: 1,
      time_mode: "ENABLED",
      availability: {},
    });
    expect(result.candidates.map((item) => item.on_site)).toEqual([true]);
  });

  it("breaks equal positive distance ties by station ID", async () => {
    const adapter = createMockDispatchAdapter([
      station("STN-A-0002", "AMBULANCE", 50, 20),
      station("STN-A-0001", "AMBULANCE", 50, 20),
    ]);
    const result = await adapter.rank({
      incident: { lat: 50.01, lng: 20 },
      vehicle_type: "AMBULANCE",
      traffic_density_multiplier: 1,
      time_mode: "ENABLED",
      availability: {},
    });
    expect(result.candidates[0].station.station_id).toBe("STN-A-0001");
  });
});
