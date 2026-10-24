import { describe, expect, it } from "vitest";

import { snapConnectorFeatures } from "@/components/map/snap-connectors";

const requested = {
  origin: { lat: 50.0612, lng: 19.9571 },
  destination: { lat: 50.0134, lng: 19.9982 },
};

describe("snapConnectorFeatures", () => {
  it("draws a requested → snapped line only for endpoints snapped farther than the minimum", () => {
    const features = snapConnectorFeatures(
      requested,
      {
        origin_snapped: { position: { lat: 50.0611, lng: 19.9568 }, snap_distance_m: 12.4 },
        destination_snapped: { position: { lat: 50.0134, lng: 19.9982 }, snap_distance_m: 2 },
      },
      5,
    );
    expect(features.features).toEqual([
      {
        type: "Feature",
        properties: { role: "origin", snapDistanceMeters: 12.4, onFoot: false },
        geometry: {
          type: "LineString",
          coordinates: [
            [19.9571, 50.0612],
            [19.9568, 50.0611],
          ],
        },
      },
    ]);
  });

  it("marks the destination connector on foot only with an on-foot leg", () => {
    const snapped = {
      origin_snapped: { position: { lat: 50.0611, lng: 19.9568 }, snap_distance_m: 12.4 },
      destination_snapped: { position: { lat: 50.016, lng: 19.998 }, snap_distance_m: 290 },
    };
    const leg = {
      access_point: snapped.destination_snapped.position,
      distance_m: 377,
      seconds: 269,
    };
    const onFoot = (route: Parameters<typeof snapConnectorFeatures>[1]) =>
      snapConnectorFeatures(requested, route, 5).features.map((f) => [
        f.properties.role,
        f.properties.onFoot,
      ]);

    expect(onFoot({ ...snapped, destination_on_foot: leg })).toEqual([
      ["origin", false],
      ["destination", true],
    ]);
    expect(onFoot({ ...snapped, destination_on_foot: null })).toEqual([
      ["origin", false],
      ["destination", false],
    ]);
    expect(onFoot(snapped)).toEqual([
      ["origin", false],
      ["destination", false],
    ]);
  });

  it("is empty without route data", () => {
    expect(snapConnectorFeatures(requested, null, 5).features).toEqual([]);
  });
});
