import { occluderPadding, type Padding } from "@/lib/workspace-layout";

/** Overlays floating over the map: workspace chrome marks itself; MapLibre's corner controls too. */
export const OCCLUDER_SELECTOR = "[data-map-occluder], .maplibregl-ctrl-bottom-right";

/** Shell attributes and element states that show, hide or move an overlay. */
const OCCLUDER_ATTRIBUTES = ["data-details", "data-sheet", "data-focus", "data-snap", "hidden"];

function occluderRoot(container: HTMLElement): ParentNode | null {
  return container.closest(".workspace-shell") ?? container.ownerDocument ?? null;
}

/**
 * Fit padding for this map from the overlays currently over it. Hidden overlays measure as
 * empty rectangles and overlays outside the map do not intersect it; both are ignored.
 */
export function measureMapPadding(container: HTMLElement): Padding {
  const root = occluderRoot(container);
  const rects = root
    ? Array.from(root.querySelectorAll(OCCLUDER_SELECTOR), (element) =>
        element.getBoundingClientRect(),
      )
    : [];
  return occluderPadding(container.getBoundingClientRect(), rects);
}

const paddingKey = (padding: Padding) =>
  [padding.top, padding.bottom, padding.left, padding.right].map(Math.round).join(",");

/**
 * Calls `onChange` (at most once per frame) when the overlays' footprint on the map changes:
 * an overlay resizes, appears, hides, or finishes a transform transition (the phone sheet
 * snaps by transform, which no ResizeObserver sees). Unchanged padding is not reported, so
 * markers added during a run never trigger a refit. Returns a disposer.
 */
export function observeOccluders(container: HTMLElement, onChange: () => void): () => void {
  const view = container.ownerDocument?.defaultView;
  const root = occluderRoot(container);
  if (!view || !root || typeof ResizeObserver === "undefined") return () => {};
  const shell = container.closest<HTMLElement>(".workspace-shell");
  let frame = 0;
  let last = paddingKey(measureMapPadding(container));
  const check = () => {
    frame = 0;
    const next = paddingKey(measureMapPadding(container));
    if (next === last) return;
    last = next;
    onChange();
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(check);
  };
  const resize = new ResizeObserver(schedule);
  const bind = () => {
    resize.disconnect();
    resize.observe(container);
    root.querySelectorAll(OCCLUDER_SELECTOR).forEach((element) => resize.observe(element));
  };
  const mutation = new MutationObserver(() => {
    bind();
    schedule();
  });
  bind();
  if (shell) {
    mutation.observe(shell, {
      attributes: true,
      attributeFilter: OCCLUDER_ATTRIBUTES,
      childList: true,
      subtree: true,
    });
    shell.addEventListener("transitionend", schedule);
  }
  return () => {
    if (frame) view.cancelAnimationFrame(frame);
    resize.disconnect();
    mutation.disconnect();
    shell?.removeEventListener("transitionend", schedule);
  };
}
