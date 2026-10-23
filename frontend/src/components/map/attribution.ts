type AttributionElement = {
  classList: { contains(name: string): boolean; remove(name: string): void };
  removeAttribute(name: string): void;
};

/**
 * MapLibre opens its compact (narrow-map) attribution expanded, covering a third of a phone map.
 * Start it collapsed; the info button still opens it.
 */
export function collapseCompactAttribution(root: {
  querySelector(selector: string): AttributionElement | null;
}): void {
  const attribution = root.querySelector(".maplibregl-ctrl-attrib");
  if (!attribution?.classList.contains("maplibregl-compact")) return;
  attribution.classList.remove("maplibregl-compact-show");
  attribution.removeAttribute("open");
}
