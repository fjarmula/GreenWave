import { describe, expect, it } from "vitest";

import { osmGhostFeatures } from "@/components/map/osm-ghost";

describe("osmGhostFeatures", () => {
  const incident = { lat: 50.05, lng: 19.96 };

  it("draws a line from the OSM position to the incident", () => {
    expect(osmGhostFeatures(incident, { lat: 50.051, lng: 19.965 })).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [19.965, 50.051],
              [19.96, 50.05],
            ],
          },
        },
      ],
    });
  });

  it("draws nothing without an OSM position", () => {
    expect(osmGhostFeatures(incident, null).features).toEqual([]);
  });
});
