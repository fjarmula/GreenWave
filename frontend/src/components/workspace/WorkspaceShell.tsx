"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { BottomSheet } from "@/components/workspace/BottomSheet";
import { WorkspaceControls } from "./WorkspaceControls";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { FollowProvider } from "@/components/map/follow-context";
import type { SheetSnap } from "@/lib/sheet-physics";
import { useIsPhone } from "@/lib/useIsPhone";

export type WorkspaceSheet = {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsed: ReactNode;
  expanded: ReactNode;
  /** Adds the phone-only minimized peek snap. */
  minimizable?: boolean;
};

export function WorkspaceShell({
  map,
  status,
  primaryAction,
  controls,
  inspector,
  sheet,
  header,
  defaultDetails = true,
  provenance = "Simulated · all signal states",
  statusAlign = "start",
}: {
  map: ReactNode;
  status?: ReactNode;
  /** Persistent action, independent of inspector scrolling, sheets and focus. */
  primaryAction?: ReactNode;
  /** Settings beside the shared camera toggle. */
  controls?: ReactNode;
  /** Which top corner the status overlay floats in. */
  statusAlign?: "start" | "end";
  /** Full desktop panel; also used on phones without a sheet. */
  inspector?: ReactNode;
  /** Phone-only draggable bottom sheet, independent of simulation mode. */
  sheet?: WorkspaceSheet;
  header: ReactNode;
  defaultDetails?: boolean;
  provenance?: string;
}) {
  const [details, setDetails] = useState(defaultDetails);
  const trigger = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLElement>(null);
  const action = useRef<HTMLDivElement>(null);
  const hasPrimaryAction = !!primaryAction;
  useEffect(() => {
    if (!action.current) return;
    const measure = () =>
      shell.current?.style.setProperty(
        "--workspace-primary-height",
        `${action.current?.offsetHeight ?? 0}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(action.current);
    return () => observer.disconnect();
  }, [hasPrimaryAction]);
  const phone = useIsPhone();
  useEffect(() => {
    if (details) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      )
        return;
      event.preventDefault();
      setDetails(true);
      requestAnimationFrame(() => trigger.current?.focus());
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [details]);
  const hasPanel = !!sheet || inspector !== undefined;
  const panelHidden = !details;
  return (
    <FollowProvider>
      <main
        ref={shell}
        className="workspace-shell"
        data-layout="map-first"
        data-primary-action={hasPrimaryAction || undefined}
        data-details={details && hasPanel}
        data-sheet={sheet && phone && !panelHidden ? sheet.snap : undefined}
      >
        <div className="workspace-map-slot" data-map-slot>
          {map}
          <span className="workspace-provenance" data-map-occluder>
            {provenance}
          </span>
        </div>
        <WorkspaceHeader
          compact={phone}
          actions={
            <>
              {!phone && <ThemeToggle />}
              {hasPanel && (
                <button
                  ref={trigger}
                  className="workspace-button"
                  aria-label="Focus Mode"
                  aria-pressed={!details}
                  aria-controls="workspace-inspector"
                  onClick={() => setDetails(!details)}
                >
                  <PanelRight aria-hidden />
                  <span className="workspace-button-label">Focus Mode</span>
                </button>
              )}
            </>
          }
        >
          {header}
        </WorkspaceHeader>
        <WorkspaceControls>{controls}</WorkspaceControls>
        {primaryAction && (
          <div ref={action} className="workspace-primary-action" data-map-occluder>
            {primaryAction}
          </div>
        )}
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
            hidden={panelHidden}
            inert={panelHidden}
          >
            {inspector}
          </aside>
        )}
        {status && (
          <div className="workspace-status" data-align={statusAlign} data-map-occluder>
            {status}
          </div>
        )}
      </main>
    </FollowProvider>
  );
}
