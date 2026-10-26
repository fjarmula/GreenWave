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
  settleSnap,
  sheetTravel,
  type SheetSnap,
  type SnapStop,
} from "@/lib/sheet-physics";

/** Movement before a press becomes a drag, so taps on buttons inside the sheet stay taps. */
const DRAG_SLOP_PX = 8;
/** Release velocity is measured over this trailing window. */
const VELOCITY_WINDOW_MS = 100;
/** Space kept under the peek row when minimized. */
const PEEK_GAP_PX = 12;
const GRABBER_LABEL: Record<SheetSnap, string> = {
  minimized: "Show setup",
  collapsed: "Show more",
  expanded: "Show less",
};
const GRABBER_NEXT: Record<SheetSnap, SheetSnap> = {
  minimized: "collapsed",
  collapsed: "expanded",
  expanded: "collapsed",
};

type Drag = {
  pointerId: number;
  startY: number;
  startTranslate: number;
  active: boolean;
  samples: { y: number; t: number }[];
};

function currentTranslate(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

/**
 * Phone bottom sheet with two snaps, or three when `minimizable`. The collapsed slot is always
 * visible; the expanded slot sits below it and is inert while collapsed. Minimized shows only
 * the collapsed slot's `[data-sheet-peek]` row and makes the rest inert. Dragging writes
 * `transform` directly (no React state per frame); releases settle with the drawer curve.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  collapsed,
  expanded,
  label,
  minimizable = false,
}: {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsed: ReactNode;
  expanded: ReactNode;
  label: string;
  /** Adds the minimized snap: only the `[data-sheet-peek]` row of the collapsed slot shows. */
  minimizable?: boolean;
}) {
  const detailsId = useId();
  const sheet = useRef<HTMLElement>(null);
  const collapsedSlot = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const finishDrag = useRef<(() => void) | null>(null);
  const [travel, setTravel] = useState<number | null>(null);
  // Minimized: translate and the height still visible (the peek row).
  const [peek, setPeek] = useState<{ translate: number; visible: number } | null>(null);

  const measure = useCallback(() => {
    const element = sheet.current;
    const slot = collapsedSlot.current;
    if (!element || !slot) return;
    const inset = parseFloat(getComputedStyle(element).paddingBottom) || 0;
    const visible = slot.offsetTop + slot.offsetHeight + inset;
    setTravel(sheetTravel(element.offsetHeight, visible));
    const peekRow = minimizable ? slot.querySelector("[data-sheet-peek]") : null;
    if (peekRow) {
      // Rects share the sheet's current transform, so their difference is layout-only.
      const top = element.getBoundingClientRect().top;
      const peekVisible = peekRow.getBoundingClientRect().bottom - top + PEEK_GAP_PX + inset;
      setPeek({ translate: sheetTravel(element.offsetHeight, peekVisible), visible: peekVisible });
    } else setPeek(null);
    element.dataset.collapsedVisible = `${visible}`;
  }, [minimizable]);

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
      finishDrag.current?.();
      if (container instanceof HTMLElement) container.style.removeProperty("--sheet-visible");
    };
  }, [measure]);

  const stops: SnapStop[] = [
    { snap: "expanded", translate: 0 },
    { snap: "collapsed", translate: travel ?? 0 },
    ...(peek ? [{ snap: "minimized" as const, translate: peek.translate }] : []),
  ];
  const translateFor = (target: SheetSnap) =>
    stops.find((stop) => stop.snap === target)?.translate ?? travel ?? 0;
  const lowest = Math.max(...stops.map((stop) => stop.translate));

  // Minimized without a peek row to show would hide the card behind an inert slot: restore it.
  useLayoutEffect(() => {
    if (snap === "minimized" && travel !== null && !peek) onSnapChange("collapsed");
  }, [snap, travel, peek, onSnapChange]);

  // Map controls and attribution stay above the visible part of the sheet (CSS reads this).
  useLayoutEffect(() => {
    const element = sheet.current;
    const container = element?.offsetParent;
    if (!element || !(container instanceof HTMLElement) || travel === null) return;
    const collapsedVisible = Number(element.dataset.collapsedVisible) || 0;
    const visible = snap === "minimized" && peek ? peek.visible : collapsedVisible;
    container.style.setProperty("--sheet-visible", `${visible}px`);
  }, [snap, peek, travel]);

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
      active: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
    drag.current = state;
    const lowestPx = lowest;

    // Until the slop is passed the pointer is not captured and may leave the sheet, so the
    // gesture is followed on the window, not on the sheet.
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== state.pointerId) return;
      const delta = moveEvent.clientY - state.startY;
      if (!state.active) {
        if (Math.abs(delta) < DRAG_SLOP_PX) return;
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
      const offset = dampedOffset(delta, -state.startTranslate, lowestPx - state.startTranslate);
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
      const settled = cancelled
        ? snap
        : settleSnap(stops, state.startTranslate, endEvent.clientY - state.startY, velocity);
      // React may not re-render when the snap is unchanged; settle the element ourselves.
      element.style.transform = `translate3d(0, ${translateFor(settled)}px, 0)`;
      if (settled !== snap) onSnapChange(settled);
    };
    const finish = () => {
      finishDrag.current = null;
      drag.current = null;
      delete element.dataset.dragging;
      if (element.hasPointerCapture(state.pointerId))
        element.releasePointerCapture(state.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
    finishDrag.current = finish;
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
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
      onClick={() => {
        // A tap anywhere on the minimized bar brings the card back.
        if (snap === "minimized") onSnapChange("collapsed");
      }}
    >
      <button
        type="button"
        className="bottom-sheet-grabber"
        onPointerDown={onPointerDown}
        aria-expanded={snap === "expanded"}
        aria-controls={detailsId}
        aria-label={GRABBER_LABEL[snap]}
        onClick={(event) => {
          event.stopPropagation();
          onSnapChange(GRABBER_NEXT[snap]);
        }}
      >
        <span aria-hidden />
      </button>
      <div ref={collapsedSlot} className="bottom-sheet-collapsed" inert={snap === "minimized"}>
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
