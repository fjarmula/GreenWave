import type { IntersectionTelemetry, RouteIntersection } from "@/types/telemetry";

/** Driver mode labels only this many upcoming junctions; the rest are unlabelled dots. */
const DRIVER_LABELLED_SIGNALS = 2;

const COORDINATE_NAME = /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/;
const NAME_SEPARATOR = " / ";

/** The next `count` intersections still ahead (a TTI), in tick order. */
export function upcomingIntersectionIds(
  intersections: readonly IntersectionTelemetry[],
  count = DRIVER_LABELLED_SIGNALS,
): Set<string> {
  return new Set(
    intersections
      .filter((intersection) => intersection.tti_seconds !== null)
      .slice(0, count)
      .map((intersection) => intersection.id),
  );
}

const streetParts = (name: string | null | undefined) => (name ? name.split(NAME_SEPARATOR) : []);

/**
 * The street that tells this junction apart from its route neighbours: the name's parts minus
 * those the previous or next junction shares (the road being driven). Falls back to the first
 * part; a missing or coordinate-only name has no label.
 */
export function distinctStreetName(id: string, route: readonly RouteIntersection[]): string | null {
  const index = route.findIndex((intersection) => intersection.id === id);
  const name = route[index]?.name;
  if (!name || COORDINATE_NAME.test(name)) return null;
  const shared = new Set([
    ...streetParts(route[index - 1]?.name),
    ...streetParts(route[index + 1]?.name),
  ]);
  const parts = streetParts(name);
  const distinct = parts.filter((part) => !shared.has(part));
  return (distinct.length > 0 ? distinct : parts.slice(0, 1)).join(NAME_SEPARATOR);
}
