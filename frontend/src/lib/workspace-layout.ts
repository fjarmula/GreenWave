/** Viewport width at which the inspector floats beside the map instead of docking below it. */
export const DESKTOP_MIN_WIDTH = 768;

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Padding = { top: number; bottom: number; left: number; right: number };

/** Clear space kept between a fitted route and the nearest map edge or overlay. */
const ROUTE_FIT_MARGIN_PX = 32;
/** Largest share of an axis the combined padding may take, so the route always has room. */
const MAX_AXIS_PADDING_SHARE = 0.6;
const EDGES = ["top", "bottom", "left", "right"] as const;

/**
 * Fit padding that keeps a route clear of the overlays floating over the map. Each overlay
 * reserves the one map edge it intrudes least from (relative to that axis, so a full-width
 * sheet always reserves the bottom); each edge keeps its largest reservation plus the margin,
 * and an axis whose two sides exceed 60 % is scaled down to it.
 */
export function occluderPadding(
  map: Rect,
  occluders: readonly Rect[],
  margin = ROUTE_FIT_MARGIN_PX,
): Padding {
  const width = Math.max(0, map.right - map.left);
  const height = Math.max(0, map.bottom - map.top);
  const reserved: Padding = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const rect of occluders) {
    const left = Math.max(rect.left, map.left);
    const right = Math.min(rect.right, map.right);
    const top = Math.max(rect.top, map.top);
    const bottom = Math.min(rect.bottom, map.bottom);
    if (right <= left || bottom <= top) continue;
    const intrusion: Padding = {
      top: bottom - map.top,
      bottom: map.bottom - top,
      left: right - map.left,
      right: map.right - left,
    };
    const share = (edge: keyof Padding) =>
      intrusion[edge] / (edge === "top" || edge === "bottom" ? height : width);
    const edge = EDGES.reduce((best, next) => (share(next) < share(best) ? next : best));
    reserved[edge] = Math.max(reserved[edge], intrusion[edge]);
  }
  const padding: Padding = {
    top: reserved.top + margin,
    bottom: reserved.bottom + margin,
    left: reserved.left + margin,
    right: reserved.right + margin,
  };
  const clamp = (a: keyof Padding, b: keyof Padding, size: number) => {
    const limit = MAX_AXIS_PADDING_SHARE * size;
    const total = padding[a] + padding[b];
    if (total <= limit) return;
    const scale = total > 0 ? limit / total : 0;
    padding[a] *= scale;
    padding[b] *= scale;
  };
  clamp("top", "bottom", height);
  clamp("left", "right", width);
  return padding;
}
