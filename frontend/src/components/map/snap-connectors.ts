import type { Position, SimulationStartResponse } from "@/types/telemetry";

/** Below this the requested and snapped points overlap on screen; no connector is drawn. */
export const SNAP_CONNECTOR_MIN_METERS = 5;

type SnapProperties = {
  role: "origin" | "destination";
  snapDistanceMeters: number;
  /** The destination of an off-road incident: the crew walks this leg (dotted, beacon). */
  onFoot: boolean;
};
// Map-layer data (GeoJSON), not a wire shape.
type SnapConnectorCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: SnapProperties;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
};

/**
 * Lines from each requested endpoint to the graph point the route really
 * starts / ends at, so the user sees why the route begins elsewhere.
 */
export function snapConnectorFeatures(
  requested: { origin: Position; destination: Position },
  route: Pick<
    SimulationStartResponse,
    "origin_snapped" | "destination_snapped" | "destination_on_foot"
  > | null,
  minimumMeters: number,
): SnapConnectorCollection {
  if (!route) return { type: "FeatureCollection", features: [] };
  const pairs = [
    ["origin", requested.origin, route.origin_snapped],
    ["destination", requested.destination, route.destination_snapped],
  ] as const;
  return {
    type: "FeatureCollection",
    features: pairs
      .filter(([, , snapped]) => snapped.snap_distance_m > minimumMeters)
      .map(([role, from, snapped]) => ({
        type: "Feature",
        properties: {
          role,
          snapDistanceMeters: snapped.snap_distance_m,
          onFoot: role === "destination" && !!route.destination_on_foot,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [from.lng, from.lat],
            [snapped.position.lng, snapped.position.lat],
          ],
        },
      })),
  };
}
