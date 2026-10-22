"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function WorkspaceShell({
  map,
  status,
  inspector,
  header,
  defaultFocus = false,
  defaultDetails = true,
  provenance = "Simulated · all signal states",
}: {
  map: ReactNode;
  status?: ReactNode;
  inspector: ReactNode;
  header: ReactNode;
  defaultFocus?: boolean;
  defaultDetails?: boolean;
  provenance?: string;
}) {
  const [focus, setFocus] = useState(defaultFocus);
  const [details, setDetails] = useState(defaultDetails);
  const trigger = useRef<HTMLButtonElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
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
  return (
    <main className="workspace-shell" data-focus={focus} data-details={details}>
      <div className="workspace-map-slot" data-map-slot>
        {map}
      </div>
      <header className="workspace-header" hidden={focus} inert={focus}>
        {header}
        <div className="flex shrink-0 gap-2">
          <button
            className="workspace-button"
            aria-expanded={details}
            aria-controls="workspace-inspector"
            onClick={() => setDetails(!details)}
          >
            Details
          </button>
          <button ref={trigger} className="workspace-button" onClick={() => changeFocus(true)}>
            Enter Focus
          </button>
        </div>
      </header>
      <aside
        id="workspace-inspector"
        aria-label="Simulation details"
        className="workspace-inspector"
        hidden={focus || !details}
        inert={focus || !details}
      >
        {inspector}
      </aside>
      {status && (
        <div className="workspace-driver-status" hidden={focus} inert={focus}>
          {status}
        </div>
      )}
      {focus && (
        <button
          ref={exit}
          className="workspace-button workspace-exit"
          onClick={() => changeFocus(false)}
        >
          Exit Focus
        </button>
      )}
      <span className="workspace-provenance">{provenance}</span>
    </main>
  );
}
