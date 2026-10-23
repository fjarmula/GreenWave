"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, Maximize2, Minimize2, PanelRight } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { BottomSheet } from "@/components/workspace/BottomSheet";
import type { SheetSnap } from "@/lib/sheet-physics";
import { DESKTOP_MIN_WIDTH } from "@/lib/workspace-layout";

export type WorkspaceSheet = {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsed: ReactNode;
  expanded: ReactNode;
  /** Desktop disclosure label for the expanded content; omitted when the card toggles it. */
  detailsLabel?: string;
};

const PHONE_QUERY = `(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`;
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
/** Phone layout by capability of the viewport; the server renders the desktop panel. */
function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

export function WorkspaceShell({
  map,
  status,
  inspector,
  sheet,
  header,
  defaultFocus = false,
  defaultDetails = true,
  provenance = "Simulated · all signal states",
}: {
  map: ReactNode;
  status?: ReactNode;
  /** Shown when there is no `sheet`. */
  inspector?: ReactNode;
  /** Phone: a draggable bottom sheet. Desktop: a compact floating card that expands. */
  sheet?: WorkspaceSheet;
  header: ReactNode;
  defaultFocus?: boolean;
  defaultDetails?: boolean;
  provenance?: string;
}) {
  const [focus, setFocus] = useState(defaultFocus);
  const [details, setDetails] = useState(defaultDetails);
  const trigger = useRef<HTMLButtonElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const phone = useIsPhone();
  const sheetDetailsId = useId();
  const changeFocus = (next: boolean) => {
    setFocus(next);
    requestAnimationFrame(() => (next ? exit : trigger).current?.focus());
  };
  useEffect(() => {
    if (!focus) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      )
        return;
      event.preventDefault();
      setFocus(false);
      requestAnimationFrame(() => trigger.current?.focus());
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [focus]);
  const panelHidden = focus || !details;
  return (
    <main
      className="workspace-shell"
      data-layout="map-first"
      data-focus={focus}
      data-details={details}
      data-sheet={sheet ? sheet.snap : undefined}
    >
      <div className="workspace-map-slot" data-map-slot>
        {map}
        <span className="workspace-provenance">{provenance}</span>
      </div>
      <header className="workspace-header" hidden={focus} inert={focus}>
        {header}
        <div className="workspace-actions">
          <ThemeToggle />
          <button
            className="workspace-button"
            aria-expanded={details}
            aria-controls="workspace-inspector"
            onClick={() => setDetails(!details)}
          >
            <PanelRight aria-hidden />
            <span className="workspace-button-label">Details</span>
          </button>
          <button ref={trigger} className="workspace-button" onClick={() => changeFocus(true)}>
            <Maximize2 aria-hidden />
            <span className="workspace-button-label">Enter Focus</span>
          </button>
        </div>
      </header>
      {sheet && phone ? (
        <div id="workspace-inspector" hidden={panelHidden} inert={panelHidden}>
          <BottomSheet
            label="Simulation details"
            snap={sheet.snap}
            onSnapChange={sheet.onSnapChange}
            collapsed={sheet.collapsed}
            expanded={sheet.expanded}
          />
        </div>
      ) : (
        <aside
          id="workspace-inspector"
          aria-label="Simulation details"
          className="workspace-inspector surface-glass"
          data-compact={sheet ? true : undefined}
          hidden={panelHidden}
          inert={panelHidden}
          onKeyDown={(event) => {
            if (!sheet || event.key !== "Escape" || sheet.snap !== "expanded") return;
            event.preventDefault();
            event.stopPropagation();
            sheet.onSnapChange("collapsed");
          }}
        >
          {sheet ? (
            <>
              {sheet.collapsed}
              {sheet.detailsLabel && (
                <button
                  type="button"
                  className="sheet-disclosure"
                  aria-expanded={sheet.snap === "expanded"}
                  aria-controls={sheetDetailsId}
                  onClick={() =>
                    sheet.onSnapChange(sheet.snap === "expanded" ? "collapsed" : "expanded")
                  }
                >
                  {sheet.detailsLabel}
                  <ChevronDown aria-hidden />
                </button>
              )}
              <div id={sheetDetailsId} hidden={sheet.snap !== "expanded"}>
                {sheet.snap === "expanded" && sheet.expanded}
              </div>
            </>
          ) : (
            inspector
          )}
        </aside>
      )}
      {status && (
        <div className="workspace-driver-status" hidden={focus} inert={focus}>
          {status}
        </div>
      )}
      {focus && (
        <button
          ref={exit}
          className="workspace-button workspace-float workspace-exit"
          onClick={() => changeFocus(false)}
        >
          <Minimize2 aria-hidden />
          Exit Focus
        </button>
      )}
    </main>
  );
}
