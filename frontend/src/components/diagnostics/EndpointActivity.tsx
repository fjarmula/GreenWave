"use client";
import {
  diagnosticOutcomeLabel,
  diagnosticTitle,
  diagnosticTickLabel,
} from "@/lib/diagnostics/presentation";
import { useState } from "react";
import { JsonInspectButton, JsonViewer, type JsonInspection } from "./JsonDetails";
import type { DiagnosticEntry } from "@/lib/diagnostics/store";
export function EndpointActivity({ entries }: { entries: ReadonlyArray<DiagnosticEntry> }) {
  const [selection, setSelection] = useState<JsonInspection | null>(null);
  return (
    <section className="mt-8" aria-labelledby="activity-title">
      <h2 id="activity-title" className="text-xl font-semibold tracking-tight">
        Recent activity
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Inspect a simulation tick’s <code>signal_phases</code> for vehicle and pedestrian colors.
        Each entry identifies its signal and controlled road approach;{" "}
        <code>is_route_movement</code>
        marks the vehicle’s direction. These are simulated approaches, not individual lane data.
      </p>
      <ol className="activity-log mt-4" aria-label="Observed activity">
        {entries.slice(-30).map((e, i) => (
          <li key={i}>
            {e.transport === "mock" ? "Synthetic" : "Backend"} · {e.operation} ·{" "}
            <strong className={e.outcome === "success" ? "text-go" : "text-caution"}>
              {diagnosticOutcomeLabel(e)}
            </strong>
            {diagnosticTickLabel(e.tick)}
            {(e.count ?? 0) > 1 ? ` · ${e.count} sampled ticks · latest payload` : ""}
            {e.capture && (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <span className="json-activity-endpoint text-xs text-muted-foreground">
                  {e.capture.method} {e.capture.path}
                  {e.capture.status === undefined ? "" : ` · ${e.capture.status}`}
                </span>
                <JsonInspectButton
                  title={diagnosticTitle(e)}
                  onClick={() =>
                    setSelection({
                      capture: { ...e.capture! },
                      title: diagnosticTitle(e),
                    })
                  }
                />
              </div>
            )}
          </li>
        ))}
        {!entries.length && <li className="text-muted-foreground">Not observed</li>}
      </ol>
      <JsonViewer selection={selection} onClose={() => setSelection(null)} />
    </section>
  );
}
