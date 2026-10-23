/** Viewport width at which the inspector floats beside the map instead of docking below it. */
export const DESKTOP_MIN_WIDTH = 768;
/** The floating desktop inspector's width plus its gap to the viewport edge. */
const DESKTOP_INSPECTOR_PX = 380 + 12;
/** Share of a phone's height the docked inspector covers. */
const PHONE_INSPECTOR_SHARE = 0.45;

/**
 * Bounded padding works even while a sheet or browser keyboard shrinks the map. The map is
 * full-bleed under floating glass, so an open inspector reserves its side (desktop) or the
 * bottom share (phone) on top of the usual margin.
 */
export function mapPadding(width: number, height: number, detailsOpen = false) {
  const [w, h] = [Math.max(0, width), Math.max(0, height)];
  const base = {
    top: Math.min(64, h / 4),
    bottom: Math.min(48, h / 4),
    left: Math.min(40, w / 4),
    right: Math.min(40, w / 4),
  };
  if (!detailsOpen) return base;
  if (w >= DESKTOP_MIN_WIDTH)
    return { ...base, right: Math.min(DESKTOP_INSPECTOR_PX + base.right, w * 0.6) };
  return { ...base, bottom: Math.min(PHONE_INSPECTOR_SHARE * h + base.bottom, h * 0.7) };
}
