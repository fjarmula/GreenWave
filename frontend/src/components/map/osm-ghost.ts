import type { Position } from "@/types/telemetry";

// Map-layer data (GeoJSON), not a wire shape.
type OsmGhostCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, never>;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
};

/**
 * A dashed line from OSM's point of an address to the incident (EMUiA's point), drawn when the
 * two sources disagree by more than 100 m (ADR 0013); empty otherwise.
 */
export function osmGhostFeatures(incident: Position, osm: Position | null): OsmGhostCollection {
  if (!osm) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [osm.lng, osm.lat],
            [incident.lng, incident.lat],
          ],
        },
      },
    ],
  };
}
