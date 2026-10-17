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
        properties: { role: "origin", snapDistanceMeters: 12.4 },
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

  it("is empty without route data", () => {
    expect(snapConnectorFeatures(requested, null, 5).features).toEqual([]);
  });
});
