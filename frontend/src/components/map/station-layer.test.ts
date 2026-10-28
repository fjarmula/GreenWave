import { describe, expect, it } from "vitest";

import { stationFeatures } from "@/components/map/station-layer";
import type { Station } from "@/types/telemetry";

const station = (station_id: string, vehicle_type: Station["vehicle_type"]): Station => ({
  station_id,
  vehicle_type,
  source_kind: vehicle_type === "AMBULANCE" ? "prm_base" : "fire_state",
  name: `Name ${station_id}`,
  position: { lat: 50.06, lng: 19.94 },
});

const STATIONS = [
  station("STN-A-0001", "AMBULANCE"),
  station("STN-A-0002", "AMBULANCE"),
  station("STN-A-0003", "AMBULANCE"),
  station("STN-F-0001", "FIRE_TRUCK"),
];

describe("stationFeatures", () => {
  it("makes one point feature per station at its position", () => {
    const collection = stationFeatures(STATIONS, "AMBULANCE", null, []);

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(4);
    expect(collection.features[0].geometry).toEqual({ type: "Point", coordinates: [19.94, 50.06] });
    expect(collection.features[0].properties).toMatchObject({
      station_id: "STN-A-0001",
      name: "Name STN-A-0001",
      vehicle_type: "AMBULANCE",
      source_kind: "prm_base",
    });
  });

  it("dims the stations of other vehicle types", () => {
    const dimmed = stationFeatures(STATIONS, "AMBULANCE", null, []).features.map(
      (feature) => feature.properties.dimmed,
    );
    expect(dimmed).toEqual([false, false, false, true]);
  });

  it("marks the chosen station and the runners-up", () => {
    const roles = stationFeatures(STATIONS, "AMBULANCE", "STN-A-0002", [
      "STN-A-0003",
      "STN-A-0001",
    ]).features.map((feature) => feature.properties.role);
    expect(roles).toEqual(["runner_up", "chosen", "runner_up", "other"]);
  });
});
