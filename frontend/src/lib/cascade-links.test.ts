import { describe, expect, it } from "vitest";

import { cascadeLinkFeatures } from "@/lib/cascade-links";
import { startResponseExample } from "@/lib/transport/__fixtures__/architecture-examples";
import type { SimulationStartResponse } from "@/types/telemetry";

function routeWithTargets(targets: string[][]): SimulationStartResponse {
  return {
    ...startResponseExample,
    route_intersections: startResponseExample.route_intersections.map((intersection, index) => ({
      ...intersection,
      cascade_targets: targets[index] ?? [],
    })),
  };
}

describe("cascadeLinkFeatures", () => {
  it("returns no features when every cascade target list is empty", () => {
    expect(cascadeLinkFeatures(routeWithTargets([[], []])).features).toEqual([]);
  });

  it("returns one correctly identified segment per source-target pair", () => {
    const features = cascadeLinkFeatures(routeWithTargets([["INT-0366"], []])).features;

    expect(features).toEqual([
      {
        type: "Feature",
        properties: { source_id: "INT-0360", target_id: "INT-0366" },
        geometry: {
          type: "LineString",
          coordinates: [
            [19.9221, 50.0661],
            [19.9243, 50.0655],
          ],
        },
      },
    ]);
  });
});
