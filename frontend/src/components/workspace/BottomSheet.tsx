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
    setTravel(sheetTravel(element.offsetHeight, slot.offsetTop + slot.offsetHeight + inset));
  }, []);

  // The container rotates or resizes and slot content changes height: both move the snaps.
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [sheet.current, collapsedSlot.current, sheet.current?.parentElement])
      if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const translateFor = (target: SheetSnap) => (target === "collapsed" ? (travel ?? 0) : 0);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (drag.current || travel === null) return; // ignore extra touch points
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTranslate: currentTranslate(event.currentTarget),
      fromContent: details.current?.contains(target) ?? false,
      active: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    const element = sheet.current;
    if (!state || !element || event.pointerId !== state.pointerId || travel === null) return;
    const delta = event.clientY - state.startY;
    if (!state.active) {
      if (Math.abs(delta) < DRAG_SLOP_PX) return;
      if (!shouldDragSheet(details.current?.scrollTop ?? 0, delta, state.fromContent)) {
        drag.current = null;
        return;
      }
      state.active = true;
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "true";
    }
    state.samples.push({ y: event.clientY, t: event.timeStamp });
    while (state.samples.length > 2 && event.timeStamp - state.samples[0].t > VELOCITY_WINDOW_MS)
      state.samples.shift();
    const offset = dampedOffset(delta, -state.startTranslate, travel - state.startTranslate);
    element.style.transform = `translate3d(0, ${state.startTranslate + offset}px, 0)`;
  };

  const endDrag = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const state = drag.current;
    const element = sheet.current;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.current = null;
    if (!state.active || !element || travel === null) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    delete element.dataset.dragging;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    const first = state.samples[0];
    const elapsed = event.timeStamp - first.t;
    const velocity = cancelled || elapsed <= 0 ? 0 : (event.clientY - first.y) / elapsed;
    const startSnap: SheetSnap = state.startTranslate > travel / 2 ? "collapsed" : "expanded";
    const target = cancelled
      ? snap
      : nextSnap(startSnap, event.clientY - state.startY, velocity, travel);
    // React may not re-render when the snap is unchanged; settle the element ourselves.
    element.style.transform = `translate3d(0, ${translateFor(target)}px, 0)`;
    if (target !== snap) onSnapChange(target);
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
      data-snap={snap}
      data-measured={travel !== null}
      style={{ transform: `translate3d(0, ${translateFor(snap)}px, 0)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
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
