export type SheetSnap = "minimized" | "collapsed" | "expanded";
/** A snap and how far below its expanded position the sheet sits there. */
export type SnapStop = { snap: SheetSnap; translate: number };

/** A release faster than this (px/ms) is a flick: its direction decides the snap. */
const FLICK_VELOCITY = 0.11;
/** Share of an overshoot past a bound the sheet still follows. */
const OVERSHOOT_FOLLOW = 0.25;

/**
 * The snap a released drag settles on. A flick moves one stop from where the drag began, in
 * its direction; a slow release settles on the stop nearest the release point. `offsetPx` and
 * `velocityPxPerMs` are positive downward (towards larger translates).
 */
export function settleSnap(
  stops: SnapStop[],
  startTranslate: number,
  offsetPx: number,
  velocityPxPerMs: number,
): SheetSnap {
  const sorted = [...stops].sort((a, b) => a.translate - b.translate);
  const nearest = (translate: number) =>
    sorted.reduce(
      (best, stop, i) =>
        Math.abs(stop.translate - translate) < Math.abs(sorted[best].translate - translate)
          ? i
          : best,
      0,
    );
  if (Math.abs(velocityPxPerMs) > FLICK_VELOCITY) {
    const step = velocityPxPerMs > 0 ? 1 : -1;
    const index = Math.max(0, Math.min(sorted.length - 1, nearest(startTranslate) + step));
    return sorted[index].snap;
  }
  return sorted[nearest(startTranslate + offsetPx)].snap;
}

/** The two-snap sheet: `travelPx` between expanded and collapsed. */
export function nextSnap(
  current: SheetSnap,
  offsetPx: number,
  velocityPxPerMs: number,
  travelPx: number,
): SheetSnap {
  return settleSnap(
    [
      { snap: "expanded", translate: 0 },
      { snap: "collapsed", translate: travelPx },
    ],
    current === "expanded" ? 0 : travelPx,
    offsetPx,
    velocityPxPerMs,
  );
}

/** Inside the bounds the sheet follows 1:1; past them it resists instead of stopping hard. */
export function dampedOffset(offsetPx: number, minPx: number, maxPx: number): number {
  if (offsetPx < minPx) return minPx + (offsetPx - minPx) * OVERSHOOT_FOLLOW;
  if (offsetPx > maxPx) return maxPx + (offsetPx - maxPx) * OVERSHOOT_FOLLOW;
  return offsetPx;
}

/**
 * A drag that starts in the scrollable details moves the sheet only when the list is at
 * its top and the drag pulls down; otherwise the list scrolls.
 */
export function shouldDragSheet(scrollTop: number, deltaY: number, fromContent: boolean): boolean {
  if (!fromContent) return true;
  return scrollTop <= 0 && deltaY > 0;
}

/** How far the collapsed sheet sits below its expanded position, from measured heights. */
export function sheetTravel(sheetHeightPx: number, collapsedHeightPx: number): number {
  return Math.max(0, sheetHeightPx - collapsedHeightPx);
}
