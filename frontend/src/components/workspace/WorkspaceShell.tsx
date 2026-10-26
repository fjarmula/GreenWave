"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Maximize2, Minimize2, PanelRight } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { BottomSheet } from "@/components/workspace/BottomSheet";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { FollowProvider } from "@/components/map/follow-context";
import type { SheetSnap } from "@/lib/sheet-physics";
import { useIsPhone } from "@/lib/useIsPhone";

export type WorkspaceSheet = {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsed: ReactNode;
  expanded: ReactNode;
  /** Desktop disclosure label for the expanded content; omitted when the card toggles it. */
  detailsLabel?: string;
  /** Desktop keeps the full `inspector` instead of the compact card. */
  phoneOnly?: boolean;
  /** Adds the minimized snap (phone: the peek row; desktop: a pill with `minimizedLabel`). */
  minimizable?: boolean;
  minimizedLabel?: string;
};

export function WorkspaceShell({
  map,
  status,
  inspector,
  sheet,
  header,
  defaultFocus = false,
  defaultDetails = true,
  provenance = "Simulated · all signal states",
  statusAlign = "start",
}: {
  map: ReactNode;
  status?: ReactNode;
  /** Which top corner the status overlay floats in. */
  statusAlign?: "start" | "end";
  /** Shown when there is no `sheet` (or it is phone-only, on desktop). */
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
  const hasPanel = !!sheet || inspector !== undefined;
  const panelHidden = focus || !details;
  const desktopSheet = sheet && !sheet.phoneOnly ? sheet : undefined;
  return (
    <FollowProvider>
      <main
        className="workspace-shell"
        data-layout="map-first"
        data-focus={focus}
        data-details={details}
        data-sheet={sheet && (phone || !sheet.phoneOnly) ? sheet.snap : undefined}
      >
        <div className="workspace-map-slot" data-map-slot>
          {map}
          <span className="workspace-provenance" data-map-occluder>
            {provenance}
          </span>
        </div>
        <WorkspaceHeader
          hidden={focus}
          actions={
            <>
              <ThemeToggle />
              {hasPanel && (
                <button
                  className="workspace-button"
                  aria-expanded={details}
                  aria-controls="workspace-inspector"
                  onClick={() => setDetails(!details)}
                >
                  <PanelRight aria-hidden />
                  <span className="workspace-button-label">Details</span>
                </button>
              )}
              <button ref={trigger} className="workspace-button" onClick={() => changeFocus(true)}>
                <Maximize2 aria-hidden />
                <span className="workspace-button-label">Enter Focus</span>
              </button>
            </>
          }
        >
          {header}
        </WorkspaceHeader>
        {sheet && phone ? (
          <div id="workspace-inspector" hidden={panelHidden} inert={panelHidden}>
            <BottomSheet
              label="Simulation details"
              snap={sheet.snap}
              onSnapChange={sheet.onSnapChange}
              collapsed={sheet.collapsed}
              expanded={sheet.expanded}
              minimizable={sheet.minimizable}
            />
          </div>
        ) : !hasPanel ? null : (
          <aside
            id="workspace-inspector"
            aria-label="Simulation details"
            className="workspace-inspector surface-glass"
            data-map-occluder
            data-compact={desktopSheet ? true : undefined}
            hidden={panelHidden}
            inert={panelHidden}
            onKeyDown={(event) => {
              if (!desktopSheet || event.key !== "Escape" || desktopSheet.snap !== "expanded")
                return;
              event.preventDefault();
              event.stopPropagation();
              desktopSheet.onSnapChange("collapsed");
            }}
          >
            {desktopSheet ? (
              <>
                {desktopSheet.collapsed}
                {desktopSheet.detailsLabel && (
                  <button
                    type="button"
                    className="sheet-disclosure"
                    aria-expanded={desktopSheet.snap === "expanded"}
                    aria-controls={sheetDetailsId}
                    onClick={() =>
                      desktopSheet.onSnapChange(
                        desktopSheet.snap === "expanded" ? "collapsed" : "expanded",
                      )
                    }
                  >
                    {desktopSheet.detailsLabel}
                    <ChevronDown aria-hidden />
                  </button>
                )}
                <div id={sheetDetailsId} hidden={desktopSheet.snap !== "expanded"}>
                  {desktopSheet.snap === "expanded" && desktopSheet.expanded}
                </div>
              </>
            ) : (
              inspector
            )}
          </aside>
        )}
        {status && (
          <div
            className="workspace-status"
            data-align={statusAlign}
            data-map-occluder
            hidden={focus}
            inert={focus}
          >
            {status}
          </div>
        )}
        {focus && (
          <button
            ref={exit}
            className="workspace-button workspace-float workspace-exit"
            data-map-occluder
            onClick={() => changeFocus(false)}
          >
            <Minimize2 aria-hidden />
            Exit Focus
          </button>
        )}
      </main>
    </FollowProvider>
  );
}
