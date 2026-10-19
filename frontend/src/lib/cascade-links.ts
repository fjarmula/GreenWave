import type { SimulationStartResponse } from "@/types/telemetry";

type CascadeLinkProperties = { source_id: string; target_id: string };

export function cascadeLinkFeatures(
  route: SimulationStartResponse,
): GeoJSON.FeatureCollection<GeoJSON.LineString, CascadeLinkProperties> {
  const intersections = new Map(
    route.route_intersections.map((intersection) => [intersection.id, intersection] as const),
  );

  return {
    type: "FeatureCollection",
    features: route.route_intersections.flatMap((source) =>
      source.cascade_targets.flatMap((targetId) => {
        const target = intersections.get(targetId);
        if (!target) return [];
        return [
          {
            type: "Feature" as const,
            properties: { source_id: source.id, target_id: target.id },
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [source.position.lng, source.position.lat],
                [target.position.lng, target.position.lat],
              ],
            },
          },
        ];
      }),
    ),
  };
}
