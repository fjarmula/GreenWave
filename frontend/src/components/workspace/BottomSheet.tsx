"use client";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  dampedOffset,
  nextSnap,
  sheetTravel,
  shouldDragSheet,
  type SheetSnap,
} from "@/lib/sheet-physics";

/** Movement before a press becomes a drag, so taps on buttons inside the sheet stay taps. */
const DRAG_SLOP_PX = 8;
/** Release velocity is measured over this trailing window. */
const VELOCITY_WINDOW_MS = 100;

type Drag = {
  pointerId: number;
  startY: number;
  startTranslate: number;
  fromContent: boolean;
  active: boolean;
  samples: { y: number; t: number }[];
};

function currentTranslate(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

/**
 * Phone bottom sheet with two snaps. The collapsed slot is always visible; the expanded
 * slot sits below it and is inert while collapsed. Dragging writes `transform` directly
 * (no React state per frame); releases settle with the drawer curve.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  collapsed,
  expanded,
  label,
}: {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsed: ReactNode;
  expanded: ReactNode;
  label: string;
}) {
  const detailsId = useId();
  const sheet = useRef<HTMLElement>(null);
  const collapsedSlot = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [travel, setTravel] = useState<number | null>(null);

  const measure = useCallback(() => {
    const element = sheet.current;
    const slot = collapsedSlot.current;
    if (!element || !slot) return;
    const inset = parseFloat(getComputedStyle(element).paddingBottom) || 0;
    const visible = slot.offsetTop + slot.offsetHeight + inset;
    setTravel(sheetTravel(element.offsetHeight, visible));
    // Map controls and attribution stay above the collapsed sheet (CSS reads this).
    if (element.offsetParent instanceof HTMLElement)
      element.offsetParent.style.setProperty("--sheet-visible", `${visible}px`);
  }, []);

  // The container rotates or resizes and slot content changes height: both move the snaps.
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    // The containing block (not the DOM parent) is what the 85% cap and the snaps follow.
    const container = sheet.current?.offsetParent ?? null;
    for (const element of [sheet.current, collapsedSlot.current, container])
      if (element) observer.observe(element);
    return () => {
      observer.disconnect();
      if (container instanceof HTMLElement) container.style.removeProperty("--sheet-visible");
    };
  }, [measure]);

  const translateFor = (target: SheetSnap) => (target === "collapsed" ? (travel ?? 0) : 0);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const element = sheet.current;
    if (drag.current || travel === null || !element) return; // ignore extra touch points
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const state: Drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTranslate: currentTranslate(element),
      fromContent: details.current?.contains(target) ?? false,
      active: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
    drag.current = state;
    const travelPx = travel;

    // Until the slop is passed the pointer is not captured and may leave the sheet, so the
    // gesture is followed on the window, not on the sheet.
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== state.pointerId) return;
      const delta = moveEvent.clientY - state.startY;
      if (!state.active) {
        if (Math.abs(delta) < DRAG_SLOP_PX) return;
        if (!shouldDragSheet(details.current?.scrollTop ?? 0, delta, state.fromContent)) {
          finish();
          return;
        }
        state.active = true;
        element.setPointerCapture(state.pointerId);
        element.dataset.dragging = "true";
      }
      state.samples.push({ y: moveEvent.clientY, t: moveEvent.timeStamp });
      while (
        state.samples.length > 2 &&
        moveEvent.timeStamp - state.samples[0].t > VELOCITY_WINDOW_MS
      )
        state.samples.shift();
      const offset = dampedOffset(delta, -state.startTranslate, travelPx - state.startTranslate);
      element.style.transform = `translate3d(0, ${state.startTranslate + offset}px, 0)`;
    };
    const release = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== state.pointerId) return;
      finish();
      if (!state.active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const cancelled = endEvent.type === "pointercancel";
      const first = state.samples[0];
      const elapsed = endEvent.timeStamp - first.t;
      const velocity = cancelled || elapsed <= 0 ? 0 : (endEvent.clientY - first.y) / elapsed;
      const startSnap: SheetSnap = state.startTranslate > travelPx / 2 ? "collapsed" : "expanded";
      const settled = cancelled
        ? snap
        : nextSnap(startSnap, endEvent.clientY - state.startY, velocity, travelPx);
      // React may not re-render when the snap is unchanged; settle the element ourselves.
      element.style.transform = `translate3d(0, ${settled === "collapsed" ? travelPx : 0}px, 0)`;
      if (settled !== snap) onSnapChange(settled);
    };
    const finish = () => {
      drag.current = null;
      delete element.dataset.dragging;
      if (element.hasPointerCapture(state.pointerId))
        element.releasePointerCapture(state.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || snap !== "expanded") return;
    event.preventDefault();
    event.stopPropagation();
    onSnapChange("collapsed");
  };

  return (
    <section
      ref={sheet}
      aria-label={label}
      className="bottom-sheet surface-glass"
      data-map-occluder
      data-snap={snap}
      data-measured={travel !== null}
      style={{ transform: `translate3d(0, ${translateFor(snap)}px, 0)` }}
      onPointerDown={onPointerDown}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="bottom-sheet-grabber"
        aria-expanded={snap === "expanded"}
        aria-controls={detailsId}
        aria-label={snap === "expanded" ? "Show less" : "Show more"}
        onClick={() => onSnapChange(snap === "expanded" ? "collapsed" : "expanded")}
      >
        <span aria-hidden />
      </button>
      <div ref={collapsedSlot} className="bottom-sheet-collapsed">
        {collapsed}
      </div>
      <div
        ref={details}
        id={detailsId}
        className="bottom-sheet-expanded"
        inert={snap !== "expanded"}
      >
        {expanded}
      </div>
    </section>
  );
}
