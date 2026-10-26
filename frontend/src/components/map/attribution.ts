// Data attribution (architecture §5); the basemap's own OSM attribution is added by its style.
// The simulation disclaimer lives in the always-visible provenance chip, not here.
export const DATA_ATTRIBUTION = [
  '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>',
  'Road network &amp; signals © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL)',
  "Street registry © City of Kraków (MSIP)",
];

/** Always the round info button: a mouse hover previews the full text, a click or tap pins it. */
export function attributionOptions() {
  return { compact: true as const, customAttribution: DATA_ATTRIBUTION };
}

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

const PEEK = "attrib-peek";
// Only the summary button pins; a click on a link or the text inside the preview must not.
const onButton = (target: unknown) =>
  !!(target as { closest?: (selector: string) => unknown } | null)?.closest?.(
    ".maplibregl-ctrl-attrib-button",
  );

type PeekElement = AttributionElement & {
  classList: { add(name: string): void };
  setAttribute(name: string, value: string): void;
  addEventListener(
    name: string,
    listener: (event: { pointerType?: string; target?: unknown }) => void,
  ): void;
  removeEventListener(
    name: string,
    listener: (event: { pointerType?: string; target?: unknown }) => void,
  ): void;
};

/**
 * The compact attribution is a closed <details>, so CSS hover cannot reveal it. A mouse over it
 * opens a preview; leaving closes it unless a click pinned it (MapLibre's compact-show).
 */
export function peekAttributionOnHover(root: {
  querySelector(selector: string): PeekElement | null;
}): () => void {
  const attribution = root.querySelector(".maplibregl-ctrl-attrib");
  if (!attribution) return () => {};
  const enter = (event: { pointerType?: string; target?: unknown }) => {
    if (event.pointerType !== "mouse" || attribution.classList.contains("maplibregl-compact-show"))
      return;
    attribution.classList.add(PEEK);
    attribution.setAttribute("open", "");
  };
  const leave = () => {
    if (!attribution.classList.contains(PEEK)) return;
    attribution.classList.remove(PEEK);
    attribution.removeAttribute("open");
  };
  // A click on the button pins it: MapLibre's toggle takes over, leave must not close it.
  const pin = (event: { target?: unknown }) => {
    if (onButton(event.target)) attribution.classList.remove(PEEK);
  };
  attribution.addEventListener("pointerenter", enter);
  attribution.addEventListener("pointerleave", leave);
  attribution.addEventListener("click", pin);
  return () => {
    attribution.removeEventListener("pointerenter", enter);
    attribution.removeEventListener("pointerleave", leave);
    attribution.removeEventListener("click", pin);
  };
}
